# Changelog

## [0.2.0](https://github.com/FB-UNIV/trip-challenges/compare/v0.1.0...v0.2.0) (2026-10-06)


### Features

* auto-advance trip phases at the planned dates ([#45](https://github.com/FB-UNIV/trip-challenges/issues/45)) ([3298fec](https://github.com/FB-UNIV/trip-challenges/commit/3298fec7a853a0087b1ecd6d74c923be2f0572ef))


### Bug Fixes

* **web:** add PWA tests and fix five silent failures they found ([#48](https://github.com/FB-UNIV/trip-challenges/issues/48)) ([1fadd5b](https://github.com/FB-UNIV/trip-challenges/commit/1fadd5b5c0d49e73658393235b822922b2635d3f))

## 0.1.0 (2026-10-06)


### Features

* **api:** alert on failed erasure, with a dead-man's-switch heartbeat ([#36](https://github.com/FB-UNIV/trip-challenges/issues/36)) ([73870e5](https://github.com/FB-UNIV/trip-challenges/commit/73870e5384bd056b5197cc93acea1fb1dae40df1))
* **api:** schema migration runner, applied at boot ([#33](https://github.com/FB-UNIV/trip-challenges/issues/33)) ([9d363ef](https://github.com/FB-UNIV/trip-challenges/commit/9d363ef3b1bcca9d280d972015ea5661361da878))


### Bug Fixes

* **api:** a database blip during a scheduler tick no longer crashes the API ([#32](https://github.com/FB-UNIV/trip-challenges/issues/32)) ([47e64ca](https://github.com/FB-UNIV/trip-challenges/commit/47e64caffbfe83562a7eb02a487e051ed842bbb4))
* **api:** a replica without the erasure lock still drains the roster ([#39](https://github.com/FB-UNIV/trip-challenges/issues/39)) ([c10f30e](https://github.com/FB-UNIV/trip-challenges/commit/c10f30ebeacbf74d3e741e6d0ce2696012a0e5af))
* **api:** an SMTP failure no longer loses a student's access code ([#34](https://github.com/FB-UNIV/trip-challenges/issues/34)) ([9077433](https://github.com/FB-UNIV/trip-challenges/commit/90774339d7229290a88abc35502c113f4928b4a6))
* **api:** erasure stays due until the Vault key is actually destroyed ([#35](https://github.com/FB-UNIV/trip-challenges/issues/35)) ([fd63824](https://github.com/FB-UNIV/trip-challenges/commit/fd63824273c691ee0ccce6c53620861f88e0113f))
* **api:** keep student PII and bearer secrets out of the logs ([#38](https://github.com/FB-UNIV/trip-challenges/issues/38)) ([db526af](https://github.com/FB-UNIV/trip-challenges/commit/db526afb004bf86da1d4fb393716b4562b4d09a0))
* **api:** make phase transitions atomic ([#41](https://github.com/FB-UNIV/trip-challenges/issues/41)) ([bcb772b](https://github.com/FB-UNIV/trip-challenges/commit/bcb772b7d3bb51580b9658563380293c56b5c540))
* **duels:** scope voting to the voter's trip and the voting period ([#31](https://github.com/FB-UNIV/trip-challenges/issues/31)) ([a4c6440](https://github.com/FB-UNIV/trip-challenges/commit/a4c6440c03cbb5f38c4636cc9c89c9c4b13e2408))
* **web:** keep trip-admin confirmations visible after a save ([#40](https://github.com/FB-UNIV/trip-challenges/issues/40)) ([06db6a9](https://github.com/FB-UNIV/trip-challenges/commit/06db6a9164a1404aea92b895fe5700881a12a5a4))
