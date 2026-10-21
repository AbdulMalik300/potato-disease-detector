# Potato & Tomato Leaf Disease Detector

Flask web app that serves fine-tuned PyTorch Vision Transformer models
(`vit_base_patch16_224`, via `timm`) for potato and tomato leaf disease
classification. Runs locally on CPU. Class lists and counts are read from the
checkpoint files, never hardcoded.

## Setup

Install CPU-only PyTorch first to avoid the huge CUDA download:

```
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu --timeout 1000
```

Then install the rest:

```
pip install flask timm pillow numpy
```

## Model files

Place the checkpoints in this folder (next to `app.py`):

- `potato_vit.pth`
- `tomato_vit.pth` (optional — until it is added, the Tomato tab runs the
  potato-trained model and labels results accordingly)

Each file must be saved in the same checkpoint format: a dict with
`model_state_dict` and `classes` keys.

```python
{
    "model_state_dict": <state dict>,
    "classes": ["...", "..."]
}
```

Every checkpoint that exists is loaded at startup; missing files are skipped
without crashing. The server prints which crops loaded and their class lists.

Model weights are ignored by git (they exceed GitHub's file-size limit). Keep
them locally, or use Git LFS if you need them versioned.

## Run

```
python app.py
```

Then open http://127.0.0.1:5000

The server loads each available model once at startup. Stop it with `Ctrl+C`.

## Endpoints

- `GET /` — the web UI
- `POST /predict` — multipart form fields `file` and `crop` (`potato` or
  `tomato`, defaults to `potato`), returns prediction JSON
- `GET /health` — `{"status":"ok","crops":{"potato":[...],"tomato":[...]}}`
- `GET /crops` — `{"crops":["potato", ...]}` listing available crops

Educational project. Not a substitute for professional agronomic advice.
