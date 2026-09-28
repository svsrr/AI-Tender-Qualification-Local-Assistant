# Backlog

Planned work that is agreed but deliberately deferred. Newest first.

## Purchase / material tenders: purchase TR mode (analysed 26.09.2026)

**Why:** Paradip also evaluates purchase tenders, with a different TR format and different
proof of execution: invoices, GeM receipt certificates and bank payment proof instead of
completion certificates. Similar nature is judged item by item, and only the similar items of
a mixed PO count.

**Plan:** detect purchase NITs and switch the tender to a 12-column purchase TR sheet
(phase 1), add purchase extraction rules (phase 2), then TR revisions (phase 3). The full
findings, plan and **open questions to settle before building** are in
[docs/purchase-tender-mode.md](docs/purchase-tender-mode.md).

## Store each bidder separately instead of one tender record (agreed 23.09.2026)

**Why:** a tender is one Firestore document holding every bidder, work order, remark, audit entry
and claimed order, and Firestore refuses any document over 1 MiB. Measured on 23.09.2026 for
`TENDER-1790003201567`: about 700 KB in the REST encoding (`ioclBidders` 174 KB, of which the
"Big Wo" bidder with 29 work orders is 128 KB, `bidders` 74 KB, `auditLogs` 12 KB). Two or three
more large dossiers reach the limit, and then **every save fails**: the engineer sees the work
continue on screen while nothing is written, exactly like the delete bug fixed in `adcd5e6`.

**Plan (about half a day with testing):**
1. Move each bidder to `tenders/{tenderId}/bidders/{bidderId}` (work orders stay inside the bidder;
   one bidder stays far below 1 MiB), leaving header data - criteria, metadata, NIT clauses,
   signatories, the edit lock - on the tender document.
2. Save only the bidder that changed, not the whole tender. Keep the version check of `adcd5e6` per
   bidder (`updatedAt` on the bidder document) so an older tab still cannot write over a newer copy.
3. `subscribeToTenderData` becomes a subscription to the bidders collection plus the tender
   document; applying a change replaces only that bidder in state.
4. Read path: load the tender document and its bidders together on open; keep reading the old
   `ioclBidders` array when the subcollection is empty, and write it back in the new shape once
   (a one-off migration per tender, like the legacy one removed earlier).
5. Keep the audit log in its own subcollection too, appended rather than rewritten.
6. Check with the 896-page dossier (29 work orders) plus 4-5 more bidders that saves stay well
   under the limit, and that two tabs still converge.

**Cheaper stopgap if the limit is hit before this lands:** drop `boundingBoxes` (evidence boxes,
regenerable from the PDF) from what is written to the cloud, and cap `auditLogs` to the most recent
entries.

## Auto-split PDFs over 20 MB (agreed 22.09.2026, planned after the write-up)

**Today:** work-order, NIT and corrigendum uploads refuse PDFs over 20 MB before sending
(`MAX_UPLOAD_MB` / `oversizeUploadMessage` in `src/utils/pdfExtractor.ts`) and ask the engineer
to split the file and upload the parts to the same bidder.

**Why the limit exists:** the PDF travels to Cloud Run as base64 (a third larger) and Cloud Run
refuses requests over 32 MiB, so ~23.9 MB of PDF is the hard ceiling; the browser only reports
"Failed to fetch". Gemini is not the limit: a 21.2 MB PDF (28.3 MiB request) was read in 23 s.

**Plan (about half a day with testing):**
1. Over 20 MB, load the PDF in the browser with `pdf-lib` (dynamically imported) and cut it into
   consecutive page ranges, each under ~18 MB (check each part's saved size while adding pages).
2. Send each part through the normal `/api/extract-document` path; parts can run in parallel.
   Show "reading part 1 of 2" in the per-bidder wait message.
3. Merge the parts' work orders as one upload. A work order and its completion certificate that
   land in different parts are merged by `splitDuplicateWorkOrders` / `mergeDuplicateWorkOrder`
   (same WO number, compatible issuer), which fills in the certificate's dates and value.
4. Shift each part's page numbers (`sourcePageStart` / `sourcePageEnd`, evidence page numbers) by
   the part's first page, so the evidence viewer points into the original PDF.
5. Keep storing the ORIGINAL full PDF with `storeSourcePdf` (Firebase Storage has no 32 MiB limit),
   so the viewer shows the real document.
6. Demo guests: each part uses one of the 3 daily extractions; say so before starting.
7. Fall back to today's "please split it" message when the PDF cannot be split: encrypted,
   damaged, or a single page over ~18 MB.

**Alternative considered:** upload the PDF to Firebase Storage first and have the server pass it
to Gemini as a file reference (Gemini Files API), lifting the limit to Gemini's 50 MB / 1000 pages.
Sends the file once, but changes how every upload travels and needs server work; auto-split keeps
the tested upload path, so it was preferred.
