const DISPOSABLE_DOMAINS = new Set([
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'mailinator.com',
  'mailinator.net',
  'maildrop.cc',
  '10minutemail.com',
  '10minutemail.net',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.net',
  'sharklasers.com',
  'grr.la',
  'spam4.me',
  'spamfree24.org',
  'trashmail.com',
  'trashmail.org',
  'trashmail.net',
  'tempmail.com',
  'tempmail.net',
  'temp-mail.org',
  'temp-mail.io',
  'throwawaymail.com',
  'mailnesia.com',
  'getnada.com',
  'nada.email',
  'emailondeck.com',
  'discard.email',
  'dispostable.com',
  'mailcatch.com',
  'mytemp.email',
  'mytempdir.com',
  'fakemail.net',
  'fakeinbox.com',
  'mailtemp.net',
  'tempinbox.com',
  'dropmail.me',
  'emailsensei.com',
  'mintemail.com',
  'moakt.com',
  'internxt.com',
  'owlymail.com',
  'luxusmail.org',
  'mailmetrash.com',
  'moburl.com',
  'mymailoasis.com',
  'nomail.xl.cx',
  'nwytg.net',
  'porchguilt.com',
  'startfu.com',
  'wuzup.net',
]);

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateStudentEmail(email: string): string | null {
  const value = email.trim().toLowerCase();

  if (!email.trim()) {
    return 'Email address is required.';
  }

  if (!EMAIL_FORMAT.test(value)) {
    return 'Enter a valid email address.';
  }

  const domain = value.split('@')[1] ?? '';

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return 'This email address is not accepted. Use a real, deliverable email.';
  }

  return null;
}