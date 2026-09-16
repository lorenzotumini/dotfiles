---
name: comfyui
disable-model-invocation: true
description: Build, inspect, debug, and run local ComfyUI workflows and headless API pipelines. Covers local installation paths, model directories, dynamic VRAM scaling (8GB up to 16GB+ like RTX 5060 Ti), node graph construction, API prompt format vs UI graph format, and local REST/WebSocket integration.
---

# Local ComfyUI Workflow & API Skill

Use this skill to inspect, construct, debug, and run local ComfyUI workflows, manage nodes and models, and automate image/video pipelines using the local ComfyUI REST API.

---

## 1. Local Environment & System Layout

The user runs a locally installed, self-contained ComfyUI environment:

* **ComfyUI Root**: `/home/lorenzo/Probe/ComfyUI`
* **Startup Script**: `/home/lorenzo/.local/bin/comfyui`
* **Python Virtual Environment**: `/home/lorenzo/Probe/ComfyUI/.venv`
* **ComfyUI Server Address**: `http://127.0.0.1:8188` (default)
* **Shared Storage Base**: `/mnt/shared/AI/ComfyUI`
  * Models: `/mnt/shared/AI/ComfyUI/models/`
    * `checkpoints/` (SD 1.5, SDXL, etc.)
    * `background_removal/` (BiRefNet, RMBG)
    * `unet/` (IC-Light, specialized diffusion UNets)
    * `loras/`
    * `vae/`
    * `upscale_models/` (RealESRGAN, etc.)
    * `facerestore_models/` (CodeFormer, GFPGAN)
  * Inputs: `/mnt/shared/AI/ComfyUI/input/`
  * Outputs: `/mnt/shared/AI/ComfyUI/output/`

### ComfyUI Manager CLI (`cm-cli`)
To inspect or install custom nodes from the shell without opening the browser:
```bash
COMFYUI_PATH=/home/lorenzo/Probe/ComfyUI /home/lorenzo/Probe/ComfyUI/.venv/bin/cm-cli show installed
COMFYUI_PATH=/home/lorenzo/Probe/ComfyUI /home/lorenzo/Probe/ComfyUI/.venv/bin/cm-cli install <node-name-or-git-url>
```

---

## 2. Hardware & VRAM Awareness (Dynamic Scaling)

Always check the current GPU status dynamically rather than assuming a fixed VRAM budget:
```bash
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
```

### When VRAM <= 8 GB (e.g., RTX 3070 Ti)
* **Checkpoints**: Stick to SD 1.5 baselines (e.g. `v1-5-pruned-emaonly-fp16.safetensors`, `dreamshaper_8.safetensors`).
* **Relighting**: Use `iclight_sd15_fc` or `iclight_sd15_fbc` (~1.7 GB). Runs fast and stays well under 4 GB VRAM.
* **Matting**: BiRefNet runs in ~1.5 GB VRAM natively.
* **Diffusion Caution**: Avoid unquantized SDXL or Flux models. If SDXL is necessary, use FP8 checkpoints or ComfyUI's `--lowvram` flag.

### When VRAM >= 16 GB (e.g., RTX 5060 Ti 16GB, RTX 4080, etc.)
* **Checkpoints**: Full SDXL checkpoints (Fooocus, Juggernaut XL) and Flux (FP8 / GGUF Q4/Q8) run smoothly.
* **Complex Multi-Pass Pipelines**: Can chain BiRefNet + SDXL IC-Light + FaceDetailer + 2x/4x Latent Upscalers in a single automated queue without memory offloading bottlenecks.

---

## 3. ComfyUI Graph Architecture: API Format vs UI Format

ComfyUI uses two distinct JSON schemas:

### A. API Prompt Format (Required for `/prompt` and Headless Automation)
Keyed by node ID as strings. Connections use `["<source_node_id>", <output_slot_index>]`:

```json
{
  "1": {
    "class_type": "LoadImage",
    "inputs": {
      "image": "portrait.png"
    }
  },
  "2": {
    "class_type": "LoadBackgroundRemovalModel",
    "inputs": {
      "bg_removal_name": "birefnet.safetensors"
    }
  },
  "3": {
    "class_type": "RemoveBackground",
    "inputs": {
      "bg_removal_model": ["2", 0],
      "image": ["1", 0]
    }
  },
  "4": {
    "class_type": "SaveImage",
    "inputs": {
      "filename_prefix": "cutout",
      "images": ["3", 0]
    }
  }
}
```

### B. UI Graph Format (`workflow.json`)
Saved by the ComfyUI browser interface. Contains `nodes`, `links`, coordinates, and visual layout. Not directly accepted by `/prompt` unless converted or opened inside the GUI.

---

## 4. Local REST API Endpoints

When building wrappers or triggering headless jobs, use these HTTP endpoints on `http://127.0.0.1:8188`:

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/prompt` | `POST` | Queue a workflow. Body: `{"prompt": <api_json>, "client_id": "<uuid>"}` |
| `/queue` | `GET` | Check running and pending jobs. |
| `/history/<prompt_id>` | `GET` | Check execution status and get output file names. |
| `/upload/image` | `POST` | Upload an image to `/mnt/shared/AI/ComfyUI/input/`. Multipart form-data: `image=@file.png` |
| `/view` | `GET` | Retrieve generated image: `/view?filename=<name>&type=output` |
| `/object_info` | `GET` | Query available node schemas, input types, and required connections. |
| `/system_stats` | `GET` | Query VRAM consumption, GPU device name, and Python environment. |

### Minimal Bash Execution Example
```bash
# 1. Upload input image
curl -s -F "image=@portrait.jpg" http://127.0.0.1:8188/upload/image

# 2. Queue prompt
PROMPT_ID=$(curl -s -X POST http://127.0.0.1:8188/prompt \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": $(cat workflow_api.json)}" | jq -r '.prompt_id')

# 3. Poll for completion
while true; do
  STATUS=$(curl -s http://127.0.0.1:8188/history/$PROMPT_ID | jq ".\"$PROMPT_ID\"")
  if [ "$STATUS" != "null" ]; then break; fi
  sleep 1
done

# 4. Extract output filename and download
FILENAME=$(echo "$STATUS" | jq -r '.outputs | to_entries[0].value.images[0].filename')
curl -s "http://127.0.0.1:8188/view?filename=$FILENAME&type=output" -o result.png
```

---

## 5. Workflow Verification Checklist

Before running or saving a workflow JSON:
1. **Source Nodes**: Ensure every pipeline has valid inputs (`LoadImage`, `CheckpointLoaderSimple`, etc.).
2. **Sink Nodes**: Ensure at least one output node (`SaveImage`, `PreviewImage`) is linked to the terminal result.
3. **Slot Index Alignment**: Output index `0` is the first output in ComfyUI's schema. Check `GET /object_info/<NodeName>` if unsure of output ordering.
4. **Data Type Matching**:
   * `IMAGE`: RGB tensor `[B, H, W, C]` (float 0.0 to 1.0).
   * `MASK`: 2D tensor `[B, H, W]`. Use nodes like `MaskToImage` or `ImageToMask` when adapting between color and alpha channels.
