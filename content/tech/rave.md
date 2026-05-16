---
title: RAVE
type: Real-time timbre transfer VAE
status: active
summary: A real-time timbre transfer neural network.
links:
  github: https://github.com/acids-ircam/RAVE
  rave: https://arxiv.org/abs/2111.05011
  fader: https://arxiv.org/pdf/2302.13542
  vst: https://forum.ircam.fr/projects/detail/rave-vst/
  demo: https://caillonantoine.github.io/ravejs/
demos:
  - https://www.youtube.com/watch?v=dMZs04TzxUI
  - https://www.youtube.com/watch?v=jAIRf4nGgYI
schematic: /assets/rave.png
featured: true
---

RAVE is a model developped at IRCAM that builds a compact latent representation from audio signals, enabling timbre transfer and latent based synthesis is real-time.

I proposed at ICASSP 2023 an extension of the model, FaderRAVE, that enables to drive the generation with high-level audio descriptors. Furthermore, I am an active contributor of the RAVE codebase and recently proposed a new version of model architecture. 

