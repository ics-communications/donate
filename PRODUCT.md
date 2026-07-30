# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two confirmed primary audiences:

- **Existing supporters** — alumni, members, and long-time friends of ICS arriving from newsletters, the Substack, or the main site (icscanada.edu). They already know and trust ICS; the page's job is to make giving frictionless.
- **New/cold visitors** — people who found ICS recently (Critical Faith podcast, search, social) and are considering a first gift. They need enough institutional context and credibility on the page itself to feel confident giving.

The page also routes major/recurring/legacy gift inquiries to Donor Relations (donorrelations@icscanada.edu, +1-416-979-2331) rather than handling them online.

## Product Purpose

The dedicated donation gateway for the Institute for Christian Studies (ICS), served at donate.icscanada.edu. Success is a completed gift: Canadian donors give through CanadaHelps (page 8522, automatic Canadian tax receipts); U.S. donors give through the charitable foundation Friends of ICS (FICS) via PayPal or cheque (U.S. tax receipts); everyone else reaches Donor Relations with a question.

## Positioning

ICS is a graduate school for philosophy and theology in Toronto, working in the Reformational tradition since 1967, and it is community-supported: donations expand scholarships, sustain public engagement, and form the next generation of Christian scholars. The donation page's distinct claim is dual-country tax-receipted giving (Canada via CanadaHelps, U.S. via FICS) presented clearly on one page.

## Operating Context

- Canadian route: CanadaHelps donation page https://www.canadahelps.org/en/dn/8522. The on-page gift form (frequency + amount picker) is presentational; payment processing happens entirely on CanadaHelps.
- U.S. route: Friends of ICS (FICS) via PayPal hosted button, or cheque to Friends of ICS, PO Box 72774, Cleveland, OH 44192-0002.
- Cheques, bank transfers, and recurring arrangements are handled by email with Donor Relations.
- The page cross-links heavily into the main site's academic, admissions, and about pages, and back to https://www.icscanada.edu/donate.

## Capabilities and Constraints

- Static single-file site (index.html + assets), no build step, no backend. No payments or personal data are handled on-site — all processing is external (CanadaHelps, PayPal).
- Hero and social-share imagery is a repo asset (assets/hero.jpg, 2048×1365 JPEG), served from the site's own domain.
- Fonts load from Google Fonts (Libre Baskerville, Outfit).
- Structured data (schema.org CollegeOrUniversity + DonateAction) and full OG/Twitter metadata are in place and should be preserved.
- **Planned expansion (confirmed):** this repo will grow beyond the single donate page to include a post-donation thank-you page and time-bound campaign/appeal pages. Specific briefs are not yet written.

## Brand Commitments

Binding, confirmed by the user: the page's visual identity — deep wine red (#7A0A1C / #9B0D24 family), warm cream/parchment neutrals, burnished copper accent, Libre Baskerville serif display with Outfit sans — is ICS's established identity for this property and future work must preserve it. The ICS name, "Institute for Christian Studies" / "ICS", favicon (assets/favicon.png), and en-CA locale are fixed.

## Evidence on Hand

- Real institutional facts: founded 1967; 59 St. George Street, Toronto, ON M5S 2E6; info@icscanada.edu; +1-416-979-2331.
- Real giving infrastructure: CanadaHelps page 8522; FICS PayPal button ID 4UGUYT3L7WN6W; FICS Cleveland cheque address.
- Real channels: Facebook, Twitter/X, Instagram, LinkedIn, YouTube, Substack, Critical Faith podcast.
- **Absent — do not fabricate:** donor testimonials, impact statistics, fundraising totals, named scholarship outcomes. None exist in the repo; future pages must source these from ICS before using them.

## Product Principles

1. **The gift is the goal.** Every element earns its place by moving a visitor toward a completed donation or a Donor Relations conversation — never toward on-page dead ends.
2. **Two countries, zero confusion.** Canadian and U.S. giving routes stay visibly distinct with their tax-receipt consequences stated plainly; a donor should never wonder which path is theirs.
3. **Trust is borrowed, then confirmed.** Existing supporters bring trust with them; new visitors must find it on the page — real addresses, real processors, real institutional history, nothing invented.
4. **Institutional warmth over fundraising pressure.** ICS speaks as a 58-year-old graduate school, not a campaign machine: generous, scholarly, direct.
5. **Hand off cleanly.** Payment complexity belongs to CanadaHelps and PayPal; the page's craft is in the approach and the handoff, not in replicating processor functionality.

## Accessibility & Inclusion

No formal standard mandated (confirmed: best effort). Maintain good accessible defaults — semantic structure, ARIA on the interactive gift form, 44px touch targets, sufficient contrast on the wine/cream palette.
