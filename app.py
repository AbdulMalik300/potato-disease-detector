import io
import os

import torch
import timm
from PIL import Image, UnidentifiedImageError
from torchvision import transforms
from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CROPS = {
    "potato": "potato_vit.pth",
    "tomato": "tomato_vit.pth",
}
MODEL_NAME = "vit_base_patch16_224"
IMAGE_SIZE = 224
LOW_CONFIDENCE_THRESHOLD = 0.60
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES


def load_checkpoint(path):
    try:
        return torch.load(path, map_location="cpu")
    except Exception:
        # torch >= 2.6 defaults weights_only=True; this is our own trusted file.
        return torch.load(path, map_location="cpu", weights_only=False)


def build_model(path):
    ckpt = load_checkpoint(path)
    classes = list(ckpt["classes"])

    model = timm.create_model(MODEL_NAME, pretrained=False, num_classes=len(classes))
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    # Warm-up forward pass so the first real request is fast.
    with torch.no_grad():
        model(torch.zeros(1, 3, IMAGE_SIZE, IMAGE_SIZE))

    return model, classes


# Preprocessing must match inference exactly: resize, tensor, normalize. No augmentation.
transform = transforms.Compose(
    [
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ]
)

print("Loading models...")


def load_all_models():
    loaded = {}
    for crop, filename in CROPS.items():
        path = os.path.join(BASE_DIR, filename)
        if not os.path.exists(path):
            print(f"[skip] {crop}: '{filename}' not found - crop disabled")
            continue
        try:
            model, classes = build_model(path)
        except Exception as exc:
            print(f"[skip] {crop}: failed to load '{filename}' ({exc}) - crop disabled")
            continue
        loaded[crop] = {"model": model, "classes": classes}
        print(f"[ok] {crop}: loaded {len(classes)} classes: {classes}")
    return loaded


MODELS = load_all_models()
print(f"Available crops: {list(MODELS.keys())}")


def prettify(name):
    last = name.split("___")[-1]
    return last.replace("_", " ").strip().title()


def error_response(message, status=400):
    return jsonify({"error": message}), status


@app.errorhandler(413)
def request_too_large(_e):
    return error_response("Image is too large. Maximum upload size is 10 MB.", 413)


@app.errorhandler(500)
def internal_error(_e):
    return error_response("Something went wrong while processing the image.", 500)


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {"status": "ok", "crops": {crop: data["classes"] for crop, data in MODELS.items()}}
    )


@app.route("/crops", methods=["GET"])
def crops():
    return jsonify({"crops": list(MODELS.keys())})


@app.route("/predict", methods=["POST"])
def predict():
    try:
        crop = (request.form.get("crop") or "potato").strip().lower()
        if crop not in MODELS:
            return error_response(
                f"The {crop} model is not installed on this server yet."
            )

        file = request.files.get("file")
        if file is None or file.filename == "":
            return error_response("No file was uploaded. Please choose an image.")

        try:
            image = Image.open(io.BytesIO(file.read())).convert("RGB")
        except (UnidentifiedImageError, OSError, ValueError):
            return error_response("That file is not a valid image. Please upload a JPG or PNG.")

        tensor = transform(image).unsqueeze(0)

        model = MODELS[crop]["model"]
        classes = MODELS[crop]["classes"]

        with torch.no_grad():
            logits = model(tensor)
            probs = torch.softmax(logits, dim=1)[0]

        probabilities = [
            {
                "class": classes[i],
                "display": prettify(classes[i]),
                "confidence": round(float(probs[i]) * 100, 2),
            }
            for i in range(len(classes))
        ]
        probabilities.sort(key=lambda item: item["confidence"], reverse=True)

        top = probabilities[0]
        top_prob = top["confidence"] / 100.0

        return jsonify(
            {
                "prediction": top["class"],
                "display_name": top["display"],
                "confidence": top["confidence"],
                "is_healthy": "healthy" in top["class"].lower(),
                "low_confidence": top_prob < LOW_CONFIDENCE_THRESHOLD,
                "probabilities": probabilities,
            }
        )
    except HTTPException:
        # Let Flask's own handlers deal with 413 (oversize upload) etc.
        raise
    except Exception:
        return error_response("Something went wrong while processing the image.", 500)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
