# The Spin Test

An interactive explainer for the spatial permutation method introduced in [Alexander-Bloch et al., 2018](https://doi.org/10.1016/j.neuroimage.2018.05.070).

**[Live demo →](https://rh42.github.io/spin-test/)**

---

## The problem

When two brain maps correlate, that might mean something, or it might mean nothing. The brain is spatially smooth: nearby regions resemble each other just for being neighbours. Two completely unrelated maps will still overlap because they're painted on the same smeared-out surface. A Pearson correlation can't distinguish that from a real signal.

## The solution

The spin test builds a proper null. One map is rotated to a random angle on the sphere, preserving its spatial structure but destroying its anatomical alignment. The rotated map is still smooth; it just no longer lines up. Correlate it with the other map and record the result. Repeat 1,000 times.

The observed correlation has to beat that distribution. If it doesn't, smoothness was doing the work.

## This explainer

A Three.js WebGL globe renders each spin live. A D3 histogram builds the null distribution in real time, with the observed correlation marked as a fixed line — you can watch whether the crowd swallows it or not.

The demo also illustrates why the null model matters: shuffling a map destroys its spatial structure entirely, making it a trivially easy bar to clear. Spinning preserves the structure and only breaks the alignment, which is the point.

## Technical notes

- Real left-hemisphere cortical surface from FreeSurfer (sphere and inflated mesh, shared face topology)
- Brain maps are synthetic analytic functions on the sphere; spatial autocorrelation is preserved
- Rotations uniform on SO(3) via the Shoemake (1992) algorithm
- No framework, no build step — static HTML, ES modules, Three.js, D3

## Reference

Alexander-Bloch, A., Shou, H., Liu, S., Satterthwaite, T. D., Glahn, D. C., Shinohara, R. T., Vandekar, S. N., & Raznahan, A. (2018). On testing for spatial correspondence between maps of human brain structure and function. *NeuroImage*, 178, 640–651. https://doi.org/10.1016/j.neuroimage.2018.05.070