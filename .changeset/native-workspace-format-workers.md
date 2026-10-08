---
'@modern-js/ultramodern-create': patch
---

Bound formatter workers during workspace generation so concurrent generation jobs do not each start a processor-sized worker pool.

Independent app configurations are evaluated in bounded pairs, preserving fresh process isolation, application order, and completion of both evaluations before returning.
