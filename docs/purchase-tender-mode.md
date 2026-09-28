# Purchase / material tenders ("purchase TR mode")

Status: **analysed, not started** (26.09.2026). Built from two Paradip Materials NITs
(`9070M24XXX` road barriers, `9070M25XXX` roof sheets) and three final purchase TRs
(road barriers, concertina coil, refractory material). Bidder names and the last three
characters of reference numbers are masked here, as in every document circulated outside
the unit.

The goal: when the uploaded NIT is a purchase tender, switch the tender to purchase mode.
It then evaluates bidders against the NIT's commercial experience criteria and produces the
committee's purchase TR format instead of the 18-column works TBA.

## 1. Telling a purchase NIT from a works NIT

No single signal is reliable, so combine them and show the engineer the mode chosen,
with its reasons and an override, the same way as ARC today:

- Title starts with "Supply of ...".
- Tender number has **M** in the fifth position (`9070M...`) where works tenders have
  **C** (`9070C...`). This is Paradip numbering only, so it is a supporting signal.
- Invited by the DGM (Materials).
- PQC is titled "Commercial experience criteria" and asks for "Proof of executed order(s)
  for *Supply of ...*".
- Supply terms are present: delivery period, FOR destination value, dispatch/transport and
  packing instructions, material tagging with the SAP code.

## 2. The purchase TR format

It is a separate, smaller sheet from the works TBA, the same in all three sample TRs:

| # | Column | Filled with |
|---|---|---|
| 1 | Sl No | one per bidder, merged down that bidder's rows |
| 2 | Bidder's Name | |
| 3 | Work Order No. & dated, Name of Issuing Organisation | PO / GeM contract number, date, "issued by ..." |
| 4 | Job Name | the item description from the PO |
| 5 | Whether meeting similar job type (Yes/No) | |
| 6 | Completion certificate / invoice submitted | the **reference** of the proof (see 3.1), not just Yes/No |
| 7 | WO value in lacs (incl. or excl. taxes, as the NIT says) | |
| 8 | Completed value in lacs | |
| 9 | Whether proforma of deviation submitted | Yes/No |
| 10 | Whether any deviation taken | Yes/No/NIL |
| 11 | Position of bidder | Technically acceptable / not acceptable / Query to be raised |
| 12 | Remarks | the TQ, the reason for rejection, or "NIL deviation" |

- **Header:** date, tender no., name of job, **estimated value** (with GST basis), similar
  job/item definition, the 1/2/3-order values with their tax basis, additional PQC.
- **Summary box:** total bids, technically acceptable, technically not acceptable.
- **Signatures:** four blocks: initiator, superior officer, next superior officer, approving
  authority (DGM).
- **Not in the purchase sheet:** start date, completion date, duration, sub-contract, owner
  approval, annualised value, NIL-deviation-sheet (the two deviation columns replace it).

## 3. Logic that differs from works tenders

### 3.1 Proof of execution (NIT clause 26, confirmed by the TRs)
Any **one** route is accepted; a PO on its own is not enough:
1. PO + invoice(s). Uploading the invoices counts as the bidder's self-certification of
   execution.
2. PO + a bank certificate of payment against the PO.
3. PO + the client's execution certificate **stating the executed value**. If the value is
   missing, the bidder must add documents from routes 1 or 2.
4. An IOCL PO cited by number and date with no documents. IOCL's internal SAP records then
   count; the LR date, or the RC date (movement type 101/103), is the execution date.

In the TRs, column 6 holds references such as `GEMCRAC-1-5116877...XXX dt ...` (GeM consignee
receipt and acceptance certificate, often several per PO), `Gem Invoice no GEM-...`, ordinary
invoice numbers, "payment receipt of invoice ...", "mail copy of credit of invoice ...",
"Completion cert no ...", "IOCL SAP Workorder and job completed" (route 4) and "Proof of
execution not submitted".

**Change needed:** today the only proof is a completion certificate, and anything else becomes
"Completion certificate not submitted" plus a query. Purchase mode must extract the proof type
**with its number and date**, sum several invoices or receipt certificates per PO, and give
route 4 its own status ("IOCL SAP records - verify").

### 3.2 Execution date
"The last date of order execution shall fall in the above-mentioned period": the last invoice
or receipt date, or the LR/RC date for route 4. The extraction prompt currently forbids any
completion date that isn't from a completion certificate. That rule is right for works but
would blank every purchase row.

### 3.3 Only the similar items in a mixed PO count
The biggest new piece. Examples:
- The refractory TR records "Total WO value Rs 59.90 L; items meeting similar nature
  48.30 L". Its `Sheet1` tab is the engineer's item-by-item working: line value, similar
  Yes/No, the Yes lines summed, then x 1.18.
- The concertina TR records "Rs 18.87 L | similar item value 10.6 L".

Purchase mode must read POs **line by line**, decide similar nature per item, sum the similar
items, and keep that working as evidence, like `Sheet1`.

### 3.4 Completed value can be below the PO value
A PO of 32.72 L was executed at 20.84 L across two receipt certificates. Sum what the invoices
and receipts prove. Never copy the PO value into the completed value.

### 3.5 Value basis
- NIT: "FOR Destination price (total landed cost incl. P&F, freight, TPI, taxes and duties)".
- TRs: the 2024 road-barrier TR is "excl. GST", with completed value = WO value / 1.18. The
  2025 and 2026 TRs are "incl. GST". The refractory working adds GST as x 1.18.
- Take the GST rate from the invoice. 18% is not universal, so flag the row when the rate is
  missing.

### 3.6 Similar nature flips polarity
The similar-job definition is the item ("Supply of Road Barriers", "Supply of Pre-coated
Sheet/GI Sheet", "Supply of Concertina coil"). Works mode correctly rejects "supply of
refractory materials is a material supply job". In purchase mode supply is exactly what
counts, so purchase needs its own prompt, not just a different definition.
Supply-and-installation orders ("Supply and fixing of concertina coil", "Installation of
concertina wire" with a completion certificate) were accepted **on the value of the similar
items only**.

### 3.7 Sub-contract logic off
POs from traders and consultants were accepted as valid orders and failed only on value.
Columns 7 and 8 of the works sheet (sub-contract, owner approval) don't apply. The works rule
that flags EPC/consultant-issued orders must not run in purchase mode.

### 3.8 Deviation
A bid without a deviation sheet is treated as a NIL-deviation bid (special instruction 3), so
there's no query for a missing sheet. The TR tracks two things: whether the proforma was
submitted, and whether any deviation was taken. A deviation taken leads to "Bidder may please
be asked to withdraw the deviation".

### 3.9 Start-up bidders
A start-up with no PO was technically acceptable ("No PO submitted | Startup bidder"). This is
a new bidder attribute (start-up, possibly MSE). The relaxation must come from the NIT, since
the works NIT disallowed it for critical jobs.

### 3.10 Aggregation
Several orders against one rate contract may be summed if the total meets the PQC. Several GeM
contracts from one GeM bid count as a single PO. Group by rate-contract or GeM-bid number
before comparing values. ARC annualisation does not apply.

### 3.11 Related parties
The NIT has a table covering mergers, takeovers, a parent using a subsidiary's experience, and
an Indian subsidiary using a foreign principal's experience. The foreign-principal case needs
a joint-and-several undertaking and a manufacturing facility in India. There is also a 50%
equity rule for the qualifying JV partner. When a PO is in another entity's name, say which
scenario applies and which document is missing; don't simply reject it.

### 3.12 Foreign currency
Orders in other currencies are converted to USD at the rate on the PO date. The app has no
exchange rates, so flag these rows for manual conversion.

### 3.13 Bidder verdict vs credential position
In the concertina TR, column 11 is set against each credential ("not acceptable" on three
orders of a bidder acceptable through a fourth). The bidder's verdict sits in the remarks:
"Technically acceptable as per GEMC-..., NIL deviation also submitted". Two remarks contradict
that bidder's own column 11 cell. Keep two separate things: whether each credential counts,
and one bidder-level verdict naming the credentials and the value option it rests on.

### 3.14 TR revisions
The road-barrier workbook has an initial TR (queries raised, deviations still taken, one
bidder without proof) and a Final TR after the replies (deviations withdrawn, values filled,
every bidder acceptable). Purchase mode needs an initial TR, then a final TR after the queries
close, with both kept on file.

### 3.15 Data problems to catch
- GeM numbers broken by spaces or misread characters (`G E M C-5 1 1 687 7 ...`,
  `GEMC-51168779I391...`). Clean them up before matching.
- An invoice dated before its PO (a 2023 invoice against a 2024 PO). Flag it.
- The estimated value is in the TR header but not in the NIT text. It needs manual entry, or
  must come from the GeM bid document.

### 3.16 NIT extraction traps (seen in the sample NITs)
- Clause 27 (annual turnover) says "Not Applicable", then continues with the usual turnover
  text and a blank "Rs." amount. The heading must win.
- Clause 31 (third-party inspection) says "Not Applicable", then a page of inspection
  requirements follows. Inspection is post-award, so keep it out of the TR.
- Clause 35 (the steel-preference policy, DMI&SP) is "Not Applicable", yet the checklist still
  asks for the Form-1 affidavit. Show the contradiction to the engineer; don't resolve it.
- The PQC is clause 26, not 11.2. Clause matching by subject already handles this.

## 4. What carries over unchanged
- The experience window is already read from the NIT: 5 years here, ending on the last day of
  the month before the original bid-submission date, the same anchor as works.
- The 1/2/3-order values (100/80/60%) use the same structure.
- Corrigenda, the evidence viewer and boxes, 1-Click TQ and the TQ register, and clause
  matching by subject.

## 5. Plan

**Phase 1: detection and the sheet**
1. Detect purchase NITs (section 1). The engineer confirms or overrides; store the mode on the
   tender.
2. Add the purchase header fields: estimated value, GST basis, similar item definition,
   start-up relaxation.
3. Build a purchase sheet with the 12 columns of section 2 and Excel/PDF export matching the
   sample TRs, including the summary box and the four signature blocks.
4. Share the existing engine: experience window, value options, evidence, TQs.

**Phase 2: purchase extraction rules**
1. A purchase prompt: supply is the similar job; supply-and-installation counts on its supply
   items.
2. Line-item extraction with a per-item similar/not-similar decision and a stored working.
3. Proof type, number and date; several invoices or receipt certificates summed per PO; the
   route-4 status.
4. Execution date from the last invoice or receipt (or LR/RC date).
5. Tax basis from the invoice's own GST rate; flag when missing.
6. Sub-contract logic off; group orders by rate contract and GeM bid; start-up exemption from
   the NIT.
7. Separate credential position from the bidder verdict (3.13).

**Phase 3: TR revisions**
1. An initial TR with queries, then a final TR after the replies, both kept on file with a
   change history.

**Test data:** the concertina tender (6 bidders, mixed GeM/non-GeM proofs, partial execution,
mixed-item POs) is the best end-to-end test. Its NIT and bid documents are still needed.

## 6. Open questions (to settle before building)

1. **Credential position:** should column 11 hold a verdict for each credential, as in the
   concertina TR, or only the bidder-level verdict?
2. **Missing GST rate:** when a PO or invoice doesn't state its GST rate, should the app
   assume 18% and say so in the remark, as the engineers did? Or should it raise a query?
3. **Tax basis conflict:** the road-barrier tender was evaluated excluding GST while its
   clause 26 says "inclusive of taxes". When the NIT and the TR header disagree, which should
   win?
4. **Receipts and acknowledgements:** should a client's material receipt or delivery
   acknowledgement (other than a GeM receipt certificate) count as route 3, with the executed
   value required? Or should it be a separate proof type?
5. **Declarations:** should purchase mode also check the insolvency, holiday-listing,
   bid-security, PPP-MII, land-border and multiple-bid declarations and Form-1? Or should the
   TR stay limited to the PQC, as for works?
6. **Other templates:** are there purchase NITs from other refineries or on other templates, so
   detection doesn't depend on Paradip's wording and numbering?
7. **Test tender:** can the concertina tender's NIT and bid documents be shared as the test
   case?
8. **Starting point:** begin with phase 1 (detection and the purchase sheet) so it can be seen
   on a real tender first?
