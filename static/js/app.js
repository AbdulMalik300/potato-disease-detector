(function () {
  "use strict";

  var dropzone = document.getElementById("dropzone");
  var dropzoneEmpty = document.getElementById("dropzone-empty");
  var previewWrap = document.getElementById("dropzone-preview");
  var previewImg = document.getElementById("preview-img");
  var changeChip = document.getElementById("change-chip");
  var fileName = document.getElementById("file-name");
  var fileSize = document.getElementById("file-size");
  var fileInput = document.getElementById("file-input");
  var scanline = document.getElementById("scanline");
  var statusText = document.getElementById("status-text");

  var tabs = Array.prototype.slice.call(document.querySelectorAll(".crop-tab"));
  var cropHeading = document.getElementById("crop-heading");
  var cropSubtitle = document.getElementById("crop-subtitle");

  var predictBtn = document.getElementById("predict-btn");
  var resetBtn = document.getElementById("reset-btn");
  var errorMsg = document.getElementById("error-msg");

  var resultCard = document.getElementById("result-card");
  var resultName = document.getElementById("result-name");
  var resultModel = document.getElementById("result-model");
  var resultChip = document.getElementById("result-chip");
  var resultConfidence = document.getElementById("result-confidence");
  var lowConfidenceNotice = document.getElementById("low-confidence-notice");
  var probList = document.getElementById("prob-list");

  var CROP_META = {
    potato: {
      heading: "Potato leaf analysis",
      subtitle: "Identify early blight, late blight, and healthy potato leaves."
    },
    tomato: {
      heading: "Tomato leaf analysis",
      subtitle: "Identify common tomato leaf conditions and healthy tomato leaves."
    }
  };

  var STATUS_MESSAGES = [
    "Preparing image...",
    "Running Vision Transformer...",
    "Computing probabilities..."
  ];

  var MAX_BYTES = 10 * 1024 * 1024;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var currentCrop = "potato";
  var availableCrops = ["potato"];
  var selectedFile = null;
  var objectUrl = null;
  var statusTimer = null;
  var analyzing = false;

  function showError(message) {
    errorMsg.textContent = message;
    errorMsg.hidden = false;
  }

  function clearError() {
    errorMsg.textContent = "";
    errorMsg.hidden = true;
  }

  function formatSize(bytes) {
    if (bytes < 1024) {
      return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(0) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function setStatus(message) {
    statusText.textContent = message;
    statusText.hidden = false;
  }

  function startStatusCycle() {
    var i = 0;
    setStatus(STATUS_MESSAGES[0]);
    statusTimer = window.setInterval(function () {
      i = (i + 1) % STATUS_MESSAGES.length;
      setStatus(STATUS_MESSAGES[i]);
    }, 1400);
  }

  function stopStatusCycle() {
    if (statusTimer) {
      window.clearInterval(statusTimer);
      statusTimer = null;
    }
    statusText.hidden = true;
  }

  function revokePreviewUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function openPicker() {
    if (analyzing) {
      return;
    }
    fileInput.value = "";
    fileInput.click();
  }

  function setPreview(file) {
    revokePreviewUrl();
    selectedFile = file;
    objectUrl = URL.createObjectURL(file);

    previewImg.src = objectUrl;
    previewImg.alt = "Preview of the selected " + currentCrop + " leaf";
    previewImg.classList.remove("dropzone__img--in");
    void previewImg.offsetWidth;
    previewImg.classList.add("dropzone__img--in");
    fileName.textContent = file.name;
    fileSize.textContent = formatSize(file.size);

    dropzoneEmpty.hidden = true;
    previewWrap.hidden = false;
    dropzone.classList.add("has-image");
    dropzone.setAttribute("aria-label", "Change the selected " + currentCrop + " leaf image");

    predictBtn.disabled = false;
    resetBtn.disabled = false;
    resultCard.hidden = true;
    scanline.hidden = true;
  }

  function clearPreview() {
    revokePreviewUrl();
    selectedFile = null;
    previewImg.removeAttribute("src");
    previewWrap.hidden = true;
    dropzoneEmpty.hidden = false;
    dropzone.classList.remove("has-image");
    fileName.textContent = "";
    fileSize.textContent = "";
    fileInput.value = "";
    predictBtn.disabled = true;
    resetBtn.disabled = true;
    scanline.hidden = true;
    dropzone.setAttribute("aria-label", "Choose or drop a " + currentCrop + " leaf image");
  }

  function handleFile(file) {
    if (analyzing || !file) {
      return;
    }
    clearError();

    if (!file.type || file.type.indexOf("image/") !== 0) {
      showError("Please choose an image file (JPG or PNG).");
      return;
    }
    if (file.size > MAX_BYTES) {
      showError("Image is too large. Maximum upload size is 10 MB.");
      return;
    }
    setPreview(file);
  }

  function clearResults() {
    resultCard.hidden = true;
    probList.innerHTML = "";
    resultConfidence.textContent = "0.00";
    resultModel.textContent = "";
    lowConfidenceNotice.hidden = true;
  }

  function reset() {
    if (analyzing) {
      return;
    }
    clearPreview();
    clearResults();
    clearError();
    stopStatusCycle();
  }

  function selectCrop(crop) {
    if (analyzing) {
      return;
    }

    var changed = crop !== currentCrop;
    currentCrop = crop;

    tabs.forEach(function (tab) {
      var on = tab.getAttribute("data-crop") === crop;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });

    var meta = CROP_META[crop];
    if (meta) {
      cropHeading.textContent = meta.heading;
      cropSubtitle.textContent = meta.subtitle;
    }
    dropzone.setAttribute("aria-label", "Choose or drop a " + crop + " leaf image");

    if (changed) {
      reset();
    }
  }

  function requestCrop() {
    if (currentCrop === "tomato" && availableCrops.indexOf("tomato") !== -1) {
      return "tomato";
    }
    return "potato";
  }

  function loadCrops() {
    fetch("/crops")
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data && Array.isArray(data.crops)) {
          availableCrops = data.crops;
        }
      })
      .catch(function () {
        availableCrops = ["potato"];
      });
  }

  function onTabKeydown(event) {
    var keys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"];
    if (keys.indexOf(event.key) === -1) {
      return;
    }
    event.preventDefault();

    if (tabs.length === 0) {
      return;
    }

    var idx = tabs.indexOf(event.currentTarget);
    var nextIdx;
    if (event.key === "Home") {
      nextIdx = 0;
    } else if (event.key === "End") {
      nextIdx = tabs.length - 1;
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIdx = (idx + 1) % tabs.length;
    } else {
      nextIdx = (idx - 1 + tabs.length) % tabs.length;
    }

    var nextTab = tabs[nextIdx];
    nextTab.focus();
    selectCrop(nextTab.getAttribute("data-crop"));
  }

  function animateNumber(el, target) {
    if (reduceMotion) {
      el.textContent = target.toFixed(2);
      return;
    }
    var start = null;
    var duration = 1100;

    function step(timestamp) {
      if (start === null) {
        start = timestamp;
      }
      var progress = Math.min((timestamp - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = (target * eased).toFixed(2);
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    }

    window.requestAnimationFrame(step);
  }

  function renderResults(data, sentCrop) {
    resultName.textContent = data.display_name;
    resultModel.textContent = "Analyzed with: " + sentCrop + "-trained model";

    var healthy = !!data.is_healthy;
    resultChip.textContent = healthy ? "Healthy" : "Disease detected";
    resultChip.className = "chip " + (healthy ? "chip--healthy" : "chip--disease");
    resultConfidence.style.color = healthy ? "var(--lime)" : "var(--disease)";

    lowConfidenceNotice.hidden = !data.low_confidence;

    probList.innerHTML = "";
    data.probabilities.forEach(function (p, index) {
      var isHealthy = p.class.toLowerCase().indexOf("healthy") !== -1;
      var variant = isHealthy ? "healthy" : "disease";

      var li = document.createElement("li");
      li.className = "prob-item" + (index === 0 ? " prob-item--top" : "");

      var head = document.createElement("div");
      head.className = "prob-item__head";

      var name = document.createElement("span");
      name.className = "prob-item__name";
      name.textContent = p.display;

      var value = document.createElement("span");
      value.className = "prob-item__value";
      value.textContent = p.confidence.toFixed(2) + "%";

      head.appendChild(name);
      head.appendChild(value);

      var bar = document.createElement("div");
      bar.className = "prob-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(p.confidence));
      bar.setAttribute("aria-label", p.display + " probability");

      var fill = document.createElement("span");
      fill.className = "prob-bar__fill prob-bar__fill--" + variant;
      bar.appendChild(fill);

      li.appendChild(head);
      li.appendChild(bar);
      probList.appendChild(li);

      var delay = reduceMotion ? 0 : index * 110;
      window.setTimeout(function () {
        fill.style.width = p.confidence + "%";
      }, 60 + delay);
    });

    resultCard.hidden = false;
    animateNumber(resultConfidence, data.confidence);
  }

  function analyze() {
    if (!selectedFile || analyzing) {
      return;
    }

    analyzing = true;
    clearError();
    clearResults();
    predictBtn.disabled = true;
    resetBtn.disabled = true;

    scanline.hidden = false;
    startStatusCycle();

    var formData = new FormData();
    var sentCrop = requestCrop();
    formData.append("file", selectedFile);
    formData.append("crop", sentCrop);

    fetch("/predict", { method: "POST", body: formData })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok || result.body.error) {
          showError(result.body.error || "Could not analyze the image. Please try again.");
          return;
        }
        renderResults(result.body, sentCrop);
      })
      .catch(function () {
        showError("Network error. Make sure the server is running and try again.");
      })
      .finally(function () {
        analyzing = false;
        stopStatusCycle();
        scanline.hidden = true;
        if (selectedFile) {
          predictBtn.disabled = false;
          resetBtn.disabled = false;
        }
      });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      selectCrop(tab.getAttribute("data-crop"));
    });
    tab.addEventListener("keydown", onTabKeydown);
  });

  dropzone.addEventListener("click", openPicker);

  dropzone.addEventListener("keydown", function (event) {
    if (event.target !== dropzone) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  });

  changeChip.addEventListener("click", function (event) {
    event.stopPropagation();
    openPicker();
  });

  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
    }
  });

  ["dragenter", "dragover"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (event) {
      event.preventDefault();
      if (!analyzing) {
        dropzone.classList.add("is-dragover");
      }
    });
  });

  ["dragleave", "dragend", "drop"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (event) {
      event.preventDefault();
      dropzone.classList.remove("is-dragover");
    });
  });

  dropzone.addEventListener("drop", function (event) {
    if (analyzing) {
      return;
    }
    var files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  });

  predictBtn.addEventListener("click", analyze);
  resetBtn.addEventListener("click", reset);

  window.addEventListener("beforeunload", revokePreviewUrl);

  selectCrop(currentCrop);
  loadCrops();
})();
