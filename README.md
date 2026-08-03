# The Spin Test

An interactive explainer for the spatial permutation method introduced in [Alexander-Bloch et al., 2018](https://doi.org/10.1016/j.neuroimage.2018.05.070).

**[Live demo →](https://rh42.github.io/spin-test/)**

---

## The problem

When two brain maps correlate, that might mean something, or it might mean nothing. The brain is spatially smooth: nearby regions resemble each other just for being neighbors. Two completely unrelated maps will still overlap because they're painted on the same smeared-out surface. A Pearson correlation can't distinguish that from a real signal.

## The solution

The spin test builds a proper null. One map is rotated to a random angle on the sphere, preserving its spatial structure but destroying its anatomical alignment. The rotated map is still smooth; it just no longer lines up. Correlate it with the other map and record the result. Repeat 1,000 times.

The observed correlation has to beat that distribution. If it doesn't, smoothness was doing the work.

## This explainer

You probe the cortex and watch a patch light up on both maps at once, which is what "they move in packs" actually looks like. You shuffle a map and win, then look at what you made. You turn the globe by hand and watch *r* move under your own fingers. You hover a bar in the histogram and meet the rotation that landed there. Both nulls get built in front of you, and the spin null's width grows out of the shuffle null's with the multiple counting up beside it, so you watch 3.6× happen.

It closes on the study's own numbers: 7,140 pairs of real brain maps, 5,331 called significant by the naive test, 35 surviving the spin test. The last frame is the thesis.

## Real data, simulated maps

The piece names both halves at once, since either on its own is a claim it cannot make.

**Real.** The cortex is the fsLR 4k left hemisphere via [neuromaps](https://netneurolab.github.io/neuromaps/). Sphere and inflated meshes share one face topology, so the morph between them interpolates vertex for vertex. The 7,140 / 5,331 / 35 counts in the closer are the paper's, measured on real maps.

**Simulated.** The two maps you correlate are analytic fields on the sphere, with spatial autocorrelation built in and no relationship to each other. Everything depends on that. Knowing the true answer is "no relationship" is what lets the piece show you one test getting it wrong (*p* < 0.001 from shuffling) and another getting it right (*p* = 0.133 from spinning) on the same pair of maps. Two real maps would leave nothing to hold the nulls against.

The correlation is computed over a 256-point Fibonacci lattice on the sphere, not over cortex vertices, so there is no medial wall to exclude and the surface serves as the stage rather than as the sample. The exported mesh does carry a real medial wall mask and real sulcal depth, but neither is read by the current piece; both are groundwork for a planned coda that spins two real annotations.

Rotations are uniform on SO(3) via the Shoemake (1992) algorithm.

## Technical notes

- No framework, no build step, nothing to install. Static HTML and ES modules.
- Three.js r160 for the WebGL stage, loaded from a CDN through an import map.
- The scatter, both histograms and the 7,140-dot field are drawn straight onto 2D canvas.
- `field.js` holds the statistical core with no DOM and no Three.js in it, so node can import it and check the numbers.
- Regenerating the mesh needs Python 3.11 and neuromaps: `brain-export/make_brain_json.py`. Its output is committed, so you only need this to change the surface itself.
- The piece needs room to work. Side by side wants ≥900px wide; stacked wants ≥600px wide and ≥800px tall. Anything smaller gets the cortex and an invitation to come back on a bigger screen.

## Versions

The first version is archived at [`/v1/`](https://rh42.github.io/spin-test/v1/): one continuously tumbling globe, a D3 histogram, everything on a single page. Its source is in `v1/`.

## Reference

Alexander-Bloch, A., Shou, H., Liu, S., Satterthwaite, T. D., Glahn, D. C., Shinohara, R. T., Vandekar, S. N., & Raznahan, A. (2018). On testing for spatial correspondence between maps of human brain structure and function. *NeuroImage*, 178, 640–651. https://doi.org/10.1016/j.neuroimage.2018.05.070
