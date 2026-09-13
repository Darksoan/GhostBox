# GhostBox Policies

Last updated: September 13, 2026

This document summarizes the main GhostBox policies for Terms of Service, Privacy, and Refunds.

## Terms of Service

GhostBox is a game library and progress management tool for games and applications that the user is authorized to run. GhostBox does not sell, distribute, provide access to, or modify games.

GhostBox Premium is a monthly subscription that provides optional features such as automatic save backups, restore points, and cloud sync. Access to Premium features may require an active subscription.

Users may cancel GhostBox Premium to stop future renewals. Canceling a subscription does not automatically refund previous charges or the current billing period.

Users are responsible for using GhostBox only with software and content they are legally allowed to access. Misuse of GhostBox or attempts to bypass third-party terms are not permitted.

### Account access (Discord / Steam only)

GhostBox accounts are created and accessed exclusively through a linked Discord or Steam account. There is no email/password sign-in and no password recovery: the linked provider account IS the key to the GhostBox account.

Users are responsible for protecting their Discord and Steam accounts, including their passwords, two-factor authentication, and recovery methods. GhostBox is not responsible for access resulting from the compromise of the user's provider account, except where the access results from a security failure or inadequate data handling by GhostBox itself.

Every account must keep at least one provider linked. Uniting two accounts (merge) requires fresh proof of both sides and an explicit confirmation; accounts are never merged automatically. Deleting the account erases its data and cannot be undone; an active subscription must be cancelled through the billing portal first.

GhostBox may change, suspend, or discontinue features as the product evolves. Subscription terms are shown during Stripe Checkout before payment is completed, and refund requests are handled under the Refund Policy.

For support questions, contact ghostbox@mail.com.

## Privacy Policy

GhostBox is designed as a local-first game management tool. Library organization data, local game entries, and local backups are handled on the user's device unless the user chooses to use cloud sync features.

Payments and approved refunds are processed by Stripe. GhostBox does not store full card numbers or payment credentials. Stripe may process payment, billing, tax, refund, and fraud prevention information according to Stripe's own policies.

For Premium features, GhostBox may process account, subscription, and sync-related data needed to provide cloud backup and sync functionality.

### Authentication and provider data

- Sign-in happens through Discord (OAuth 2.0, scopes `identify email`) or Steam (OpenID). GhostBox stores the provider's stable id, the displayed name/username, and avatar reference so the app can show who is linked. The provider's email address, when reported, is stored as contact information only — it is never used for sign-in or recovery.
- Provider access tokens are used once during the sign-in handshake and are never stored.
- GhostBox sessions are HMAC-signed tokens valid for 7 days, revocable when providers are linked/unlinked or accounts are merged. A short audit trail of sign-ins and account changes (event type, provider, and coarse IP prefix such as `192.168.1.0`, never the full address) is kept for 90 days so users can notice access that was not theirs.
- Sign-in rate-limit counters keep the full IP for up to 24 hours.
- Steam game statistics shown in the app (owned games, playtime, achievements, wishlist) are cached per account for up to 180 days to keep the interface fast.
- Accounts are deleted on request through the app (Settings → Account → Delete). Billing records that the law requires GhostBox to keep (payments, invoices) are retained separately from the deleted account for the legally required period.

Refund and support requests may require the user to provide account, billing, and issue details so GhostBox can review the request and identify the related Stripe payment.

GhostBox does not sell personal data. Privacy-related questions can be sent to ghostbox@mail.com.

## Refund Policy

GhostBox Premium is billed monthly. Users may cancel their subscription to stop future renewals, but cancellation does not automatically refund previous charges or the current billing period.

Refund requests should be submitted within 7 days of the original payment. Requests made after this period may still be reviewed when required by applicable law or when there is a clear billing or technical issue.

Refunds are not automatic. Each request is reviewed based on the account status, payment record, and the reason for the request. If a technical issue prevents access to paid Premium features and cannot be resolved, a refund may be issued for the affected billing period.

Approved refunds are processed through Stripe and may take 5-10 business days to appear depending on the payment method and bank.

Because GhostBox Premium is a digital service, partial-month refunds are not guaranteed unless required by applicable law.

To request support or a refund review, contact ghostbox@mail.com with the account email, billing date, and a short description of the issue.
