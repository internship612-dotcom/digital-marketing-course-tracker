---
name: Course Tracker authentication decision
description: Why this app keeps role-based username/email/password authentication in the product.
---

The app intentionally uses application-managed password authentication with PostgreSQL-backed HTTP-only sessions for admins, teachers, and students.

**Why:** The product brief explicitly requires a default admin credential, teacher usernames, and student email/password registration and login across three roles; replacing this with provider-only auth would change the requested product behavior.

**How to apply:** Preserve the role-aware login contract, hashed password storage, session expiry, and admin password-change path when extending authentication.