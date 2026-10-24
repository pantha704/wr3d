# Security policy

## Scope

This project is a **static client-side game**. There is no backend, no accounts,
no telemetry, and no data leaves the player's browser. Saves live in IndexedDB
on the player's own device.

Because of that, the realistic security surface is small:

- XSS through anything rendered from save data
- supply-chain risk in the build toolchain
- dependency vulnerabilities

## Reporting

Open a private security advisory on the repository (Security → Report a
vulnerability). Please do not file public issues for exploitable problems.

Expect an acknowledgement within a few days. There is no bug bounty.

## Out of scope

- Save-file editing or "cheating" — it is a single-player game with no
  leaderboards; editing your own save is not a vulnerability.
- Issues that require a modified browser or compromised device.
- The original game this project analyses; report those to its publisher.

## Supported versions

Only the latest `main` deployment is supported.
