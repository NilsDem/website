---
title: PLATUNE
type: Adding controls on top of pretrained neural audio codec
status: active
summary: 
links:
  github: https://github.com/acids-ircam/platune/
  paper: https://hal.science/hal-05495076v1/file/_ISMIR25_temporal_contols_on_pretrained_audio_generative_models_camera_ready.pdf
  webpage: https://acids-ircam.github.io/platune/
demos:
schematic: /assets/platune.png
schematic_alt: Platune system schematic
used_by:
featured: true
---

PLATUNE is a controllable generative audio framework that makes it possible to shape and transform sound using expressive, time-varying musical descriptors. Instead of training a new model for every control parameter, PLATUNE can add new controls directly on top of existing pretrained generative models and neural audio codecs, making advanced audio manipulation far more flexible and accessible.

The system learns a structured latent space where musical attributes such as timbre, brightness, dynamics, articulation, or other continuous descriptors can be independently edited while preserving the identity and style of the original sound.


