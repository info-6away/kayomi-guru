import { expect, test } from '@playwright/test';
import { canInstallFrom } from '../../lib/install';

test('Koyomi is offered for installation at its own address only', () => {
  expect(canInstallFrom('app.koyomi.guru')).toBe(true);
  // Local builds, so the offer can be seen and tested.
  expect(canInstallFrom('localhost')).toBe(true);
  expect(canInstallFrom('127.0.0.1')).toBe(true);

  // The landing page, the Vercel address, previews, and hosts that only look right.
  for (const host of ['koyomi.guru', 'www.koyomi.guru', 'kayomi-guru.vercel.app', 'kayomi-guru-git-main.vercel.app', 'app.koyomi.guru.example.com', 'notapp.koyomi.guru']) {
    expect(canInstallFrom(host), host).toBe(false);
  }
});
