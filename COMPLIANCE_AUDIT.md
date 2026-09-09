# ShilpSarathi Seller compliance audit

Audit date: 7 September 2026

## Product boundary

This build is the seller application only. It contains no buyer role, buyer navigation, customer catalogue, reviews, ratings, payment collection, ordering or refund processing. A buyer product must use a different application identifier and repository/build target.

## Data inventory

| Data | Purpose | Required | Current storage or processor |
| --- | --- | --- | --- |
| Phone number | Authentication and account security | Yes | Firebase when production authentication is enabled |
| Seller name | Profile and listing attribution | Yes | Local device and configured application database |
| Product photo | Listing creation and image cleanup | Per listing | Configured storage and AI provider |
| Voice recording or typed description | Listing generation | One of the two | Configured storage and AI provider |
| Listing and price | Inventory and sharing | Per listing | Configured application database |

No delivery address, date of birth, gender, government identity, contacts, location, bank information or buyer data is collected by the seller UI.

## Tracking and cookies

- Analytics: none detected.
- Advertising trackers: none detected.
- Third-party embeds or iframes: none detected.
- Browser cookies: none set by application code.
- Essential local storage: language, login state, explicit policy-consent record and offline listing queue.
- Optional-cookie banner: implemented but disabled while optional cookies remain disabled. Enabling analytics requires a new consent and vendor audit.

## Claims and content

- Fake reviews and ratings: removed from the seller build.
- Sales, ranking, profit and marketplace-acceptance guarantees: expressly disclaimed.
- AI content and pricing: labelled for seller review; no accuracy guarantee.
- Image rights: not yet evidenced. Record source, author, license and modification rights for each file under `assets/`. Production release remains blocked until `ASSET_RIGHTS_CONFIRMED=true` is deliberately set.
- Voice assets: record the speech provider terms and generation date before release.

## Open release blockers

1. Add the real legal entity name, registered or principal address, contact email, phone, registration identifier and grievance officer to `business-config.js`. These values must not be invented.
2. Have Indian counsel review the policies against the actual entity, data retention schedule, AI vendors, hosting regions and commercial model.
3. Configure an account deletion and media-deletion operational process, including response ownership and retention exceptions.
4. Confirm Firebase, AI, hosting, database and storage sub-processors and cross-border transfer locations in the Privacy Policy.
5. If buyers, payments, commissions or subscriptions are later added, conduct a separate Consumer Protection and e-commerce review before launch.
6. Enforce Firebase token verification and seller-level ownership authorization on every non-public API route before deployment. The current local API is not an authorization boundary.
7. Obtain professional translations of the policies and consent wording for every language offered in the seller app; the current legal pages are English working drafts.

## Indian-law risk map

- The Digital Personal Data Protection Act, 2023 and notified Digital Personal Data Protection Rules, 2025 require an accurate notice, valid consent where relied upon, reasonable security safeguards, grievance handling and data-principal request processes. Commencement is phased; counsel must confirm which provisions apply on the planned release date.
- The Information Technology Act, 2000 continues to create confidentiality, privacy and security obligations.
- Consumer Protection Act and E-Commerce Rules become more significant if the operator facilitates buyer transactions, payments, commissions, returns or marketplace functions. This seller-only tool currently does not do so.
- Product-specific laws, tax, legal metrology, geographical indications, intellectual property, advertising and marketplace requirements remain the seller's and operator's separate compliance responsibilities.

This audit reduces obvious product risk but is not a legal opinion or a guarantee against liability.
