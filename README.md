# The Spin Test

An interactive explainer for the spatial permutation test from [Alexander-Bloch et al., 2018](https://doi.org/10.1016/j.neuroimage.2018.05.070): why two brain maps can look correlated when they aren't, and how rotating one on the sphere builds a fair null.

**[Live demo →](https://rh42.github.io/spin-test/)**

---

## Real data, simulated maps

**Real.** The cortex is the fsLR 4k left hemisphere via [neuromaps](https://netneurolab.github.io/neuromaps/). The sphere and inflated meshes share one face topology, so the morph between them interpolates vertex for vertex. The 7,140 / 5,331 / 35 counts at the end come from the paper and were measured on real maps.

**Simulated.** The two maps you correlate are analytic fields on the sphere, with spatial autocorrelation built in and no relationship to each other. Because the true answer is known to be "no relationship", the explainer can show one test getting it wrong (*p* < 0.001 from shuffling) and another getting it right (*p* = 0.133 from spinning) on the same pair of maps. Two real maps would give no known answer to check the nulls against.

The correlation is computed over a 256-point Fibonacci lattice on the sphere, so there is no medial wall to exclude, and the cortex surface is there for display only. The exported mesh includes a real medial wall mask and real sulcal depth. The current version uses neither; they're groundwork for a planned final section that spins two real annotations.

Rotations are uniform on SO(3) via the Shoemake (1992) algorithm.

## Technical notes

- No framework, no build step, nothing to install. Static HTML and ES modules.
- Three.js r160 for the WebGL stage, loaded from a CDN through an import map.
- The scatter, both histograms and the 7,140-dot field are drawn straight onto 2D canvas.
- `field.js` holds the statistical core with no DOM and no Three.js in it, so node can import it and check the numbers.
- Regenerating the mesh needs Python 3.11 and neuromaps: `brain-export/make_brain_json.py`. Its output is committed, so you only need this to change the surface itself.
- The explainer needs a large screen. Side by side wants ≥900px wide; stacked wants ≥600px wide and ≥800px tall. Anything smaller gets the cortex and an invitation to come back on a bigger screen.

## Versions

The first version is archived at [`/v1/`](https://rh42.github.io/spin-test/v1/): one continuously tumbling globe, a D3 histogram, everything on a single page. Its source is in `v1/`.

## Reference

Alexander-Bloch, A., Shou, H., Liu, S., Satterthwaite, T. D., Glahn, D. C., Shinohara, R. T., Vandekar, S. N., & Raznahan, A. (2018). On testing for spatial correspondence between maps of human brain structure and function. *NeuroImage*, 178, 640–651. https://doi.org/10.1016/j.neuroimage.2018.05.070