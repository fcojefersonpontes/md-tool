---
title: Quarterly report
---

# Quarterly report

Revenue grew **18%** this quarter, driven by the _new pricing_ and fewer ~~churned~~ accounts.

- [x] Close the books
- [x] Review the forecast
- [ ] Send the report

| Region   | Q1 (k$) | Q2 (k$) | Change |
| :------- | ------: | ------: | :----: |
| Americas |     420 |     498 |  +19%  |
| Europe   |     310 |     362 |  +17%  |
| Asia     |     150 |     177 |  +18%  |

The growth rate is $g = \frac{R_2 - R_1}{R_1}$, and the yearly projection is

$$
R_{year} = R_1 \cdot \sum_{k=0}^{3} (1 + g)^k
$$

```ts
export function growth(before: number, after: number): number {
  return (after - before) / before;
}
```

```mermaid
flowchart LR
  Draft --> Review --> Approved
  Review -- changes --> Draft
```
