# Partial returns: design for review (not built)

Written 30 Oct 2026. The owner wants a customer to bring back some pieces now and the rest later.
**TRENDZ has no such thing**: its return is all-or-nothing. So this is new behaviour, not a copy; nothing here is
built until the owner approves it.

## How a return works today
- `complete_rental` returns every piece that is out, in one call: a condition per piece, charges, what happens to
  the deposit, the last payment. The rental then goes `active` to `completed` and cannot be returned again.
- A piece that does not come back must be marked lost in that same call; there is no way to leave it out.
- Late fees are suggested for the whole rental at the one return time (`return_suggestions`).

## Proposal
Keep one rental. Pieces come back one visit at a time; the rental closes with the last piece.

1. **New function `return_pieces(rental_id, p)`**: `p = {returned_at, checks: [{unit_id, condition, notes, photo_paths}]}`
   for only the pieces coming back now. Each returned piece is checked, freed after the booking's cleaning days
   (as `complete_rental` does), and goes to service if damaged or is marked lost. The rental stays `active`.
2. **`complete_rental` stays the closing call.** It already works on the pieces that are still out, so it handles
   "the rest" without change, and it does the money settlement (deposit kept or refunded, last payment).
   If nothing is out any more, `return_pieces` closes the rental by itself and asks for the same settlement input.
3. **No new rental status.** The mobile contract's status list does not change. "Partly returned" is shown from the
   pieces: the rental data gains `pieces_out` and `pieces_returned` (additive, old apps ignore them).
4. **Late fees per visit.** `return_suggestions` gets an optional list of pieces and suggests the late days for
   those pieces at that visit. Staff confirm; the charge is booked then, not at the end. A piece that was late
   pays for its own days.
5. **Deposit stays held until the rental closes** (see question 1). Nothing about "refund no more than deposit"
   changes.
6. **Money rules are untouched:** total = lines + extras + charges - discount; paid never above total; balance never
   negative. Damage or lost charges are booked when the piece is returned or marked lost.

## Screens
- Return dialog: the pieces are ticked as they come back (already so). New button **Return selected (n)** next to
  **All received**; unticked pieces stay out. A piece that is not coming back is simply left unticked (marking it
  lost stays a deliberate choice).
- Booking page and lists: "2 of 3 pieces back", with the codes still out. The rental is `Out` until the last piece
  is back.
- Dashboard: the rental stays in Overdue / Returns due while any piece is out; its row lists only the pieces
  still out. WhatsApp reminders name only those pieces.
- Calendar and Inventory Search: a returned piece is free again after its cleaning days; the rest stay out.
- Scan to receive back: scanning one piece opens the return with that piece ticked (already so) and now offers
  **Return selected** as the normal path.

## Tests to write
Database: partial return frees only the returned pieces and holds them for the cleaning days; the rental stays
`active`; the last return closes it and settles the deposit; a late piece gets its own late fee, an on-time one
none; damaged or lost on a partial visit; money invariants after each step; a piece cannot be returned twice; staff
of another branch cannot return. Browser: scan one of two pieces back, see "1 of 2 back", scan the other, see the
rental close.

## Size
One migration (a function, a change to `return_suggestions`, two derived counts), changes to the return dialog,
booking page, dashboard and WhatsApp text, about the size of the cleaning-days work. No change to the shape of
existing function calls.

## Questions for the owner
1. **Deposit on a partial return**: hold all of it until the last piece is back (proposed, simplest and safest), or
   allow a part to be given back earlier? TRENDZ gives nothing back until the end.
2. **Late fee per visit** as proposed (each piece pays for its own late days), or once at the end for the whole
   rental?
3. **A piece that never comes back**: stays out until staff mark it lost (then the rental can close), or close the
   rental with a "not returned" note?
4. **Receipt**: one receipt when the rental closes, or a short return slip at each visit?
5. Should this also apply to car, bike and resort shops later, or only clothes?
