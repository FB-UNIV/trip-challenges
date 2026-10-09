# Changelog

## [0.9.0](https://github.com/FB-UNIV/trip-challenges/compare/v0.8.0...v0.9.0) (2026-10-09)


### Features

* **api:** boot self-checks for storage and Vault; /readyz says which dependency is down ([#116](https://github.com/FB-UNIV/trip-challenges/issues/116)) ([2b2ff2a](https://github.com/FB-UNIV/trip-challenges/commit/2b2ff2a7f7bb9af7063668333920750ecb775ca8))
* students can play solo, a team is no longer required ([#120](https://github.com/FB-UNIV/trip-challenges/issues/120)) ([b709850](https://github.com/FB-UNIV/trip-challenges/commit/b7098501cafed2e668f9834a0d65c891f8a017f3))
* students see whether their entry is pending, approved or not accepted ([#119](https://github.com/FB-UNIV/trip-challenges/issues/119)) ([0504b91](https://github.com/FB-UNIV/trip-challenges/commit/0504b918028912985736538cbc5e9bedb94965f7))
* **web:** bigger duel photos on phones, with full-screen zoom ([#117](https://github.com/FB-UNIV/trip-challenges/issues/117)) ([7ce6fc4](https://github.com/FB-UNIV/trip-challenges/commit/7ce6fc4bd58357443f77b989fdaebf32d0295a7e))
* **web:** failures say what went wrong, with a reference to report ([#114](https://github.com/FB-UNIV/trip-challenges/issues/114)) ([e9f4735](https://github.com/FB-UNIV/trip-challenges/commit/e9f47353ddad47ad8f3d812d1a2be280c10ac1b0))
* **web:** skeleton placeholders instead of the last "Loading…" texts ([#118](https://github.com/FB-UNIV/trip-challenges/issues/118)) ([2251c03](https://github.com/FB-UNIV/trip-challenges/commit/2251c03e6623478f2e5e875bc2e682094ded8d32))

## [0.8.0](https://github.com/FB-UNIV/trip-challenges/compare/v0.7.0...v0.8.0) (2026-10-08)


### Features

* **api:** one error shape with request ids; dependency outages answer 503 ([#112](https://github.com/FB-UNIV/trip-challenges/issues/112)) ([2fae76d](https://github.com/FB-UNIV/trip-challenges/commit/2fae76da090c9c3eab1fe510299cd08dac0c3747))


### Bug Fixes

* **api:** hash student session tokens with SHA-256, not argon2 ([#110](https://github.com/FB-UNIV/trip-challenges/issues/110)) ([c90f539](https://github.com/FB-UNIV/trip-challenges/commit/c90f539336252746bfbdf64ef1d0cdfee44740bd))
* erasure fails loudly and retries; S3 delete errors no longer ignored ([#111](https://github.com/FB-UNIV/trip-challenges/issues/111)) ([efc7da0](https://github.com/FB-UNIV/trip-challenges/commit/efc7da046283832d3e14f917a392cbaf22d872fd))

## [0.7.0](https://github.com/FB-UNIV/trip-challenges/compare/v0.6.0...v0.7.0) (2026-10-08)


### Features

* **web:** instant approve/reject and nominate (optimistic, with rollback) ([#107](https://github.com/FB-UNIV/trip-challenges/issues/107)) ([1ee2b86](https://github.com/FB-UNIV/trip-challenges/commit/1ee2b86231b1fd602b1d68bf8bf3ea64c0f3cfe6))
* **web:** shared data cache — student screens stay fresh without refreshing ([#105](https://github.com/FB-UNIV/trip-challenges/issues/105)) ([b39c2eb](https://github.com/FB-UNIV/trip-challenges/commit/b39c2ebebf51cc7195e4fa81567a77f34c32a662))
* **web:** teacher desk on the shared cache — instant section switches, live trip data ([#106](https://github.com/FB-UNIV/trip-challenges/issues/106)) ([078a75c](https://github.com/FB-UNIV/trip-challenges/commit/078a75c92894f96e468f3db780cf76ff4547c530))


### Bug Fixes

* **web:** form fields stay inside their cards on phones ([#103](https://github.com/FB-UNIV/trip-challenges/issues/103)) ([b79870a](https://github.com/FB-UNIV/trip-challenges/commit/b79870abfd7c3d1f33741874c363315d12d724a6))

## [0.6.0](https://github.com/FB-UNIV/trip-challenges/compare/v0.5.0...v0.6.0) (2026-10-08)


### Features

* **api:** teacher student list — Joined/Invited/Undelivered, resend a code, fix an undelivered address ([#100](https://github.com/FB-UNIV/trip-challenges/issues/100)) ([edd3556](https://github.com/FB-UNIV/trip-challenges/commit/edd3556685f7d39b87c96df8332e26487f09c017))
* **api:** teacher teams — list with activity, rename and review names before the reveal ([#99](https://github.com/FB-UNIV/trip-challenges/issues/99)) ([b54a527](https://github.com/FB-UNIV/trip-challenges/commit/b54a527e9442d65c63676449ba5fa9ec1717d1f8))
* **web:** Students page — who joined, undelivered codes, teams and the names to check ([#101](https://github.com/FB-UNIV/trip-challenges/issues/101)) ([4f4049b](https://github.com/FB-UNIV/trip-challenges/commit/4f4049bb01ad27c3abbc288c81902893f083b1b0))


### Bug Fixes

* **api:** unreviewed team names never survive erasure ([#98](https://github.com/FB-UNIV/trip-challenges/issues/98)) ([ff5ae3c](https://github.com/FB-UNIV/trip-challenges/commit/ff5ae3cea4e81c176305af73a259234961d6c7e1))

## [0.5.0](https://github.com/FB-UNIV/trip-challenges/compare/v0.4.0...v0.5.0) (2026-10-08)


### Features

* **api:** teacher trip progress — team, photo and moderation counts, effective erasure date ([#86](https://github.com/FB-UNIV/trip-challenges/issues/86)) ([f3df1ee](https://github.com/FB-UNIV/trip-challenges/commit/f3df1ee49010facdb610f593e2b13d19b05767f7))
* **web:** printable QR sheet; challenges editor with errors and empty state ([#89](https://github.com/FB-UNIV/trip-challenges/issues/89)) ([924e106](https://github.com/FB-UNIV/trip-challenges/commit/924e10631513e10093252cbaedc4f99045ea3f66))
* **web:** review queue — grouped by challenge, approved list, confirmed photo removal ([#88](https://github.com/FB-UNIV/trip-challenges/issues/88)) ([067fb6c](https://github.com/FB-UNIV/trip-challenges/commit/067fb6c319370cff6d89134fc122f1b73efff81d))
* **web:** roster progress and failed emails; settings, invites and results report errors ([#91](https://github.com/FB-UNIV/trip-challenges/issues/91)) ([db87afe](https://github.com/FB-UNIV/trip-challenges/commit/db87afedf89c1a0a12adbb41b4c3040a820d4c48))
* **web:** teacher home — trip cards by phase, past trips apart, new trip on demand ([#90](https://github.com/FB-UNIV/trip-challenges/issues/90)) ([d5c9711](https://github.com/FB-UNIV/trip-challenges/commit/d5c971124182126506a23b083d5465db7d290398))
* **web:** teacher Now card — per-phase checklist, countdowns, erasure warning, confirmed advance ([#87](https://github.com/FB-UNIV/trip-challenges/issues/87)) ([9602323](https://github.com/FB-UNIV/trip-challenges/commit/9602323adfd930c5ff91ea4b7e97efb624e26ebc))
* **web:** teacher UI kit — confirm dialog, notice, useAction, copy field, stats, section nav ([#83](https://github.com/FB-UNIV/trip-challenges/issues/83)) ([32e33fe](https://github.com/FB-UNIV/trip-challenges/commit/32e33fef9ee54578dce5072524c24f2285922753))
* **web:** trip admin split into sections with a nav; erasure behind a typed confirmation ([#84](https://github.com/FB-UNIV/trip-challenges/issues/84)) ([1c5c7ed](https://github.com/FB-UNIV/trip-challenges/commit/1c5c7edc6c2bc1e32a2a43b0a7a2f4896c75cf77))

## [0.4.0](https://github.com/FB-UNIV/trip-challenges/compare/v0.3.0...v0.4.0) (2026-10-07)


### Features

* **api:** per-student challenge progress for the checklist and vote list ([#73](https://github.com/FB-UNIV/trip-challenges/issues/73)) ([3773053](https://github.com/FB-UNIV/trip-challenges/commit/3773053dc0069cfcdfd6069172d36290767e7eb4))
* **web:** bottom tab bar for students with to-do badges ([#78](https://github.com/FB-UNIV/trip-challenges/issues/78)) ([aaa1ef2](https://github.com/FB-UNIV/trip-challenges/commit/aaa1ef25b60ac60c99fc59565f477cb2348bdf61))
* **web:** challenge checklist for students (/challenges) ([#76](https://github.com/FB-UNIV/trip-challenges/issues/76)) ([db3de17](https://github.com/FB-UNIV/trip-challenges/commit/db3de1791d368c802c52d710a9c3628e7f840215))
* **web:** student UI kit — progress, checklist, stepper, bottom tab bar ([#72](https://github.com/FB-UNIV/trip-challenges/issues/72)) ([e01731d](https://github.com/FB-UNIV/trip-challenges/commit/e01731d933e7879e0682053ac8b571ca000e0ff9))
* **web:** team page shows next steps and a challenge preview ([#77](https://github.com/FB-UNIV/trip-challenges/issues/77)) ([fcf5226](https://github.com/FB-UNIV/trip-challenges/commit/fcf52261038c681d8bfb6a57133cb89c06748213))
* **web:** vote list with progress, done challenges and a next-challenge jump ([#75](https://github.com/FB-UNIV/trip-challenges/issues/75)) ([0c78d92](https://github.com/FB-UNIV/trip-challenges/commit/0c78d9239749436d9fa94160a4b0bca0dd60756a))

## [0.3.0](https://github.com/FB-UNIV/trip-challenges/compare/v0.2.0...v0.3.0) (2026-10-06)


### Features

* **api:** seed staging with demo trips (draft, voting, reveal) ([#66](https://github.com/FB-UNIV/trip-challenges/issues/66)) ([8f51857](https://github.com/FB-UNIV/trip-challenges/commit/8f518573e25c97912a4cafc1a18cdb987e729424))


### Bug Fixes

* rate-limit per client behind the proxy; explain failures instead of 'Something went wrong' ([#70](https://github.com/FB-UNIV/trip-challenges/issues/70)) ([43571f4](https://github.com/FB-UNIV/trip-challenges/commit/43571f4e81cdb417088734e0e8ecfb554db43153))

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
