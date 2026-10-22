# AW4 Fund Reversal And Valuation Extension

Owner decisions, October 21, 2026:

- Online Store remains last. Implement these two extensions locally first.
- Fund reversal is a separate, authorized command, reversing the entire original
  Capital/Operating allocation in its exact original split. Block if either fund
  cannot cover its own debit. Do not pay cash, rewrite the receipt, or change the
  invoice's collection status. Preserve original entries and append linked reversals.
- Return valuation uses immutable original invoice amounts, including discounts
  and tax, quantity precision 0.001, and cumulative rounding. The final full return
  must reconcile exactly to the original amount. No current-price/rate repricing.
- Existing invoices contain header-only discount/tax snapshots. Owner approved
  proportional allocation against original gross line totals in stable line-ID
  order, with cumulative half-up cent rounding for each header component. Preserve
  these derived original allocations in each new immutable credit-note line.
- Returned money is the difference between cumulative rounded original payable
  amounts, not independently rounded amounts for each requested slice. Reject
  zero-cent selections without changing stock or financial history; never round
  them up to a cent. Free/zero-payable lines remain unsupported in this increment.
- Item/category report amounts use the same original payable basis for wholesale
  invoices; original collections, charged header taxes and discounts are not
  rewritten by a credit note or by fund reversal.

Implementation and QA in progress. No hosted migrations, credentials, deployment,
or financial UAT are authorized by this local development decision. AW3's unresolved
execution restriction and frozen release scope remain unchanged.
