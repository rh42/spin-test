from nilearn import datasets
import nibabel as nib
import numpy as np
import json


fs = datasets.fetch_surf_fsaverage(mesh='fsaverage4')


def read_geom(path):
    g = nib.load(path)
    coords = np.asarray(g.darrays[0].data, dtype=float)
    faces = np.asarray(g.darrays[1].data, dtype=int)
    return coords, faces


sph, faces = read_geom(fs['sphere_left'])
inf, faces2 = read_geom(fs['infl_left'])

if sph.shape != inf.shape:
    raise ValueError(f"Shape mismatch: sphere {sph.shape}, inflated {inf.shape}")

if not np.array_equal(faces, faces2):
    raise ValueError("Face mismatch between sphere_left and infl_left")

sph = sph / np.linalg.norm(sph, axis=1).mean()
inf = inf - inf.mean(axis=0)
inf = inf / np.abs(inf).max() * 1.4

out = {
    "verts": int(sph.shape[0]),
    "faces": faces.astype(int).ravel().tolist(),
    "sphere": sph.astype(np.float32).round(4).ravel().tolist(),
    "inflated": inf.astype(np.float32).round(4).ravel().tolist(),
}

try:
    sulc = nib.load(fs['sulc_left']).agg_data()
    out["sulc"] = np.asarray(sulc, dtype=np.float32).round(3).tolist()
except Exception:
    pass

with open("brain.json", "w") as f:
    json.dump(out, f)

print(out["verts"], "verts,", len(out["faces"]) // 3, "faces")
print("wrote brain.json")

