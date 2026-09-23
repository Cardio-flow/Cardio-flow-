# Recovered product sources

Recovered and verified 16 September 2026. Original HTML files are read-only references outside this repository; no legacy database was contacted.

| Source            | Local file                              |   Bytes | SHA-256                                                            |
| ----------------- | --------------------------------------- | ------: | ------------------------------------------------------------------ |
| EP / EPS Registry | `/Users/ahmed/Downloads/index (7).html` |  473465 | `bf18fd6ee78803a83e01830c6cf821317658fd19fff2697cbf6aa46f301bd106` |
| HF Registry       | `/Users/ahmed/Downloads/index (8).html` | 1033598 | `e0d59cced38cbf1b9c2438895912c812b92d088332c986bbf9bc9488163e4d58` |
| SACC CAD Registry | `/Users/ahmed/Downloads/index (9).html` |  256705 | `958828751cbe4df5ed645dfee73ea7a2702fc52464f6283718e01a0b5191a79b` |

All hashes match the 5 September audit. The original inventory `../work/registry_inventory.json` contains 2,252 extracted field rows (HF 1,377; CAD 352; EP 523) and 2,671 value-set rows. Counts include repeated contexts, not 2,252 distinct approved concepts.

`legacy-field-catalog.csv` preserves source keys, labels, sections, proposed target entities and review states. It excludes application code, service configuration, investigator option values and clinical algorithms. Proposed mappings are not completed implementations or approvals.

Recovered conversations:

- **Final Codex Plan**, `6a9d534d-e9dc-83ed-8e01-8a46c1ea0e0c`: accepted navigation and continuous-care behaviour; final handoff preserved in `docs/MASTERPLAN.md`.
- **Platform Case Example**, `6a9dcacf-6708-83eb-ab04-ce89ace5f3ad`: fictional Hassan journey, coexisting diseases, complications, discharge obligations, linked OPD and optional registries.
- **Upload Registry Codebases**, `6a9c1340-f4ec-83ed-8493-6786e46caaa3`: original uploads and shared-core reuse requirements.

The final chat references `CardioFlow_Codex_Masterplan.md` v1.2 and `CardioFlow_Clinical_Blueprint_v1.md` v1.1. Those actual attachments were not present in the synced `sources/` directory or targeted Downloads/Documents/Desktop searches. The recovered conversation supports this care foundation; do not claim to have read the missing files or implement their clinical rules from memory.

| Source     | Preserve                                                                                             | Current coverage                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| HF         | Longitudinal visits, dated investigations, medication reasons, monitoring, discharge/OPD obligations | Shared care documentation implemented; complete HF fields, medication tables and structured imaging pending |
| CAD        | Conditional forms, lesion/stent detail, coded dictionaries, outcomes and exports                     | Limited existing CRF retained; full 352-row parity pending                                                  |
| EP         | Procedure-specific disclosure, ablation/devices, locking, follow-up and exports                      | Independent procedure documentation implemented; full procedural forms pending                              |
| Final plan | Current situation, owner, decision/action/response, linked journeys, optional/custom registries      | Care foundation implemented; complete pathways, attachments, builder and research workflows pending         |

Do not restore direct browser writes to legacy Firebase, clinical PINs, executable configuration, or undocumented treatment logic.
