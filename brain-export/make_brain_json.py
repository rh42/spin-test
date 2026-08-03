"""Export the fsLR 4k left hemisphere (sphere + inflated, shared faces) to brain.json.

Geometry only. The two maps the piece correlates are analytic fields built in field.js;
no annotation is exported here and none is read on screen.

fsLR rather than fsaverage is groundwork for a planned coda that spins two real HCP
annotations (myelin and thickness, both fsLR 32k). Sharing one space makes that
resampling 32k -> 4k a nearest-neighbour match inside a single spherical
parameterisation, which needs no connectome-workbench.

Run with brain-export/.venv311 (Python 3.11 + neuromaps).
    .venv311/bin/python make_brain_json.py [out.json]
"""
import json
import sys
import warnings

import nibabel as nib
import numpy as np

warnings.filterwarnings("ignore")
from neuromaps.datasets import fetch_atlas  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "brain.json"
HEMI = 0  # 0 = left, matching the original fsaverage4 export

atlas = fetch_atlas("fsLR", "4k")

sph, faces = nib.load(atlas["sphere"][HEMI]).agg_data()
inf, faces_i = nib.load(atlas["inflated"][HEMI]).agg_data()
sph = np.asarray(sph, dtype=float)
inf = np.asarray(inf, dtype=float)
faces = np.asarray(faces, dtype=int)

if sph.shape != inf.shape:
    raise ValueError(f"Shape mismatch: sphere {sph.shape}, inflated {inf.shape}")
if not np.array_equal(faces, np.asarray(faces_i, dtype=int)):
    raise ValueError("Face mismatch between sphere and inflated")

# Same normalisation as the fsaverage4 export, so main.js needs no retuning:
# sphere -> unit radius (SPH_R scales it up in JS), inflated -> centred, max extent 1.4
sph = sph / np.linalg.norm(sph, axis=1).mean()
inf = inf - inf.mean(axis=0)
inf = inf / np.abs(inf).max() * 1.4

# Present the lateral surface to a camera on +z, anterior to the left, superior up.
#
# Raw FreeSurfer/fsLR axes are x = L-R (the thin one), y = A-P, z = I-S, which puts the
# hemisphere edge-on to the camera, showing a narrow blade. The beats hold still, so the
# rest pose has to be right without motion to rescue it.
#
#   screen x <- -y  (anterior to the left)
#   screen y <-  z  (superior up)
#   depth  z <- -x  (lateral surface toward the camera; left hemisphere is at x < 0)
#
# det = +1, so this is a rotation, not a reflection, and it does not mirror the anatomy.
# Applied to sphere and inflated alike, so the morph and the correlation sampling stay
# in register.
rot = np.array([[0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [-1.0, 0.0, 0.0]])
if not np.isclose(np.linalg.det(rot), 1.0):
    raise ValueError("orientation matrix is not a proper rotation")
sph = sph @ rot.T
inf = inf @ rot.T

out = {
    "verts": int(sph.shape[0]),
    "faces": faces.ravel().tolist(),
    "sphere": sph.astype(np.float32).round(4).ravel().tolist(),
    "inflated": inf.astype(np.float32).round(4).ravel().tolist(),
}

# Medial wall: 1 = cortex, 0 = wall. Synthetic fields have no wall, but the real
# annotations do, and rotated wall vertices must be dropped from the statistic.
try:
    medial = np.asarray(nib.load(atlas["medial"][HEMI]).agg_data())
    out["medial"] = medial.astype(np.uint8).tolist()
except Exception as exc:
    print("medial wall unavailable:", exc)

try:
    sulc = np.asarray(nib.load(atlas["sulc"][HEMI]).agg_data(), dtype=np.float32)
    out["sulc"] = sulc.round(3).tolist()
except Exception as exc:
    print("sulc unavailable:", exc)

with open(OUT, "w") as f:
    json.dump(out, f)

print(f"{out['verts']} verts, {len(out['faces']) // 3} faces -> {OUT}")
if "medial" in out:
    print(f"  cortex {int(np.sum(out['medial']))} / {out['verts']} vertices")
