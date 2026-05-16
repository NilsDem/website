---
title: AFTER
type: Real-time timbre transfer and MIDI synthesis
status: active
summary: AFTER allows to imprint the timbre/style of one source onto the musical structure of another.
links:
  github: https://github.com/acids-ircam/AFTER/
  paper: https://arxiv.org/abs/2408.00196
  webpage: https://nilsdem.github.io/control-transfer-diffusion/
demos:
  - /assets/site/demo_after_midi.mp4
  - /assets/site/demo_after_drums.mp4
schematic: /assets/after.png
schematic_alt: AFTER system schematic
used_by:
  - Canblaster
  - Björk and Robin Meier
  - Holly Herndon and Mat Dryhurst
featured: true
---

AFTER is a real-time latent diffusion synthesizer that lets you apply the timbre and style of one sound to the musical structure of another, enabling expressive style transfer and the creation of hybrid sonic textures. It is the first latent-diffusion instrument designed for live performance, featuring an 2D timbre map that makes the model’s latent space directly playable and explorable. 

The open-source repository enables artists and researchers to train personalized models, create custom Max for Live devices, and transform audio or MIDI sources in live performance and creative production workflows. 

A online demo of the model is available [here](https://nilsdem.github.io/AFTER/web_onnx_app/).

