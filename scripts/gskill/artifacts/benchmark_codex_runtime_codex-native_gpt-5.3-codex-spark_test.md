# Codex Runtime Skill Benchmark

- Generated: 2026-02-22T08:45:33.730207+00:00
- Runtime: `codex-native`
- Model: `gpt-5.3-codex-spark`
- Split filter: `test`

| Suite | Candidate | Split | Avg Score | Req Cov | Pref Cov | Avg Latency (s) | Success |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| codex-superapp-bootstrap | baseline_none | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | baseline_none | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | baseline_none | test | 0.1600 | 0.0000 | 0.0000 | 7.444 | 1.00 |
| codex-superapp-bootstrap | baseline_none | overall | 0.1600 | 0.0000 | 0.0000 | 7.444 | 1.00 |
| codex-superapp-bootstrap | baseline_seed | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | baseline_seed | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | baseline_seed | test | 0.6933 | 0.8333 | 0.0000 | 6.798 | 1.00 |
| codex-superapp-bootstrap | baseline_seed | overall | 0.6933 | 0.8333 | 0.0000 | 6.798 | 1.00 |
| codex-superapp-bootstrap | gepa_optimized_core | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | gepa_optimized_core | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | gepa_optimized_core | test | 0.6867 | 0.6667 | 0.5000 | 7.651 | 1.00 |
| codex-superapp-bootstrap | gepa_optimized_core | overall | 0.6867 | 0.6667 | 0.5000 | 7.651 | 1.00 |
| codex-superapp-bootstrap | codex_split_pack | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | codex_split_pack | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | codex_split_pack | test | 0.9000 | 1.0000 | 0.5000 | 4.786 | 1.00 |
| codex-superapp-bootstrap | codex_split_pack | overall | 0.9000 | 1.0000 | 0.5000 | 4.786 | 1.00 |
| codex-superapp-bootstrap | codex_enterprise_split_pack | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | codex_enterprise_split_pack | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| codex-superapp-bootstrap | codex_enterprise_split_pack | test | 0.1600 | 0.0000 | 0.0000 | 11.686 | 1.00 |
| codex-superapp-bootstrap | codex_enterprise_split_pack | overall | 0.1600 | 0.0000 | 0.0000 | 11.686 | 1.00 |
| foundation-contracts | baseline_none | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | baseline_none | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | baseline_none | test | 0.2667 | 0.1667 | 0.0000 | 8.226 | 1.00 |
| foundation-contracts | baseline_none | overall | 0.2667 | 0.1667 | 0.0000 | 8.226 | 1.00 |
| foundation-contracts | baseline_seed | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | baseline_seed | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | baseline_seed | test | 0.3200 | 0.2500 | 0.0000 | 8.469 | 1.00 |
| foundation-contracts | baseline_seed | overall | 0.3200 | 0.2500 | 0.0000 | 8.469 | 1.00 |
| foundation-contracts | gepa_optimized_core | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | gepa_optimized_core | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | gepa_optimized_core | test | 0.5550 | 0.5000 | 0.3750 | 6.104 | 1.00 |
| foundation-contracts | gepa_optimized_core | overall | 0.5550 | 0.5000 | 0.3750 | 6.104 | 1.00 |
| foundation-contracts | codex_split_pack | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | codex_split_pack | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | codex_split_pack | test | 0.4517 | 0.4167 | 0.1250 | 8.931 | 1.00 |
| foundation-contracts | codex_split_pack | overall | 0.4517 | 0.4167 | 0.1250 | 8.931 | 1.00 |
| foundation-contracts | codex_enterprise_split_pack | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | codex_enterprise_split_pack | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| foundation-contracts | codex_enterprise_split_pack | test | 0.7600 | 0.8333 | 0.3333 | 4.550 | 1.00 |
| foundation-contracts | codex_enterprise_split_pack | overall | 0.7600 | 0.8333 | 0.3333 | 4.550 | 1.00 |
| superapp-development | baseline_none | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | baseline_none | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | baseline_none | test | 0.2667 | 0.1667 | 0.0000 | 7.841 | 1.00 |
| superapp-development | baseline_none | overall | 0.2667 | 0.1667 | 0.0000 | 7.841 | 1.00 |
| superapp-development | baseline_seed | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | baseline_seed | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | baseline_seed | test | 0.1600 | 0.0000 | 0.0000 | 4.550 | 1.00 |
| superapp-development | baseline_seed | overall | 0.1600 | 0.0000 | 0.0000 | 4.550 | 1.00 |
| superapp-development | gepa_optimized_core | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | gepa_optimized_core | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | gepa_optimized_core | test | 0.3167 | 0.1667 | 0.2500 | 4.548 | 1.00 |
| superapp-development | gepa_optimized_core | overall | 0.3167 | 0.1667 | 0.2500 | 4.548 | 1.00 |
| superapp-development | codex_split_pack | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | codex_split_pack | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | codex_split_pack | test | 0.3733 | 0.3333 | 0.0000 | 5.624 | 1.00 |
| superapp-development | codex_split_pack | overall | 0.3733 | 0.3333 | 0.0000 | 5.624 | 1.00 |
| superapp-development | codex_enterprise_split_pack | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | codex_enterprise_split_pack | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| superapp-development | codex_enterprise_split_pack | test | 0.6367 | 0.6667 | 0.2500 | 4.012 | 1.00 |
| superapp-development | codex_enterprise_split_pack | overall | 0.6367 | 0.6667 | 0.2500 | 4.012 | 1.00 |
| enterprise-delivery | baseline_none | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | baseline_none | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | baseline_none | test | 0.1568 | 0.0000 | 0.0000 | 9.727 | 1.00 |
| enterprise-delivery | baseline_none | overall | 0.1568 | 0.0000 | 0.0000 | 9.727 | 1.00 |
| enterprise-delivery | baseline_seed | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | baseline_seed | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | baseline_seed | test | 0.1600 | 0.0000 | 0.0000 | 7.354 | 1.00 |
| enterprise-delivery | baseline_seed | overall | 0.1600 | 0.0000 | 0.0000 | 7.354 | 1.00 |
| enterprise-delivery | gepa_optimized_core | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | gepa_optimized_core | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | gepa_optimized_core | test | 0.1933 | 0.0000 | 0.1667 | 7.013 | 1.00 |
| enterprise-delivery | gepa_optimized_core | overall | 0.1933 | 0.0000 | 0.1667 | 7.013 | 1.00 |
| enterprise-delivery | codex_split_pack | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | codex_split_pack | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | codex_split_pack | test | 0.4800 | 0.5000 | 0.0000 | 5.590 | 1.00 |
| enterprise-delivery | codex_split_pack | overall | 0.4800 | 0.5000 | 0.0000 | 5.590 | 1.00 |
| enterprise-delivery | codex_enterprise_split_pack | train | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | codex_enterprise_split_pack | val | 0.0000 | 0.0000 | 0.0000 | 0.000 | 0.00 |
| enterprise-delivery | codex_enterprise_split_pack | test | 0.5133 | 0.5000 | 0.1667 | 4.551 | 1.00 |
| enterprise-delivery | codex_enterprise_split_pack | overall | 0.5133 | 0.5000 | 0.1667 | 4.551 | 1.00 |

## Winners (test split)

- codex-superapp-bootstrap: codex_split_pack
- foundation-contracts: codex_enterprise_split_pack
- superapp-development: codex_enterprise_split_pack
- enterprise-delivery: codex_enterprise_split_pack
- overall: codex_enterprise_split_pack
