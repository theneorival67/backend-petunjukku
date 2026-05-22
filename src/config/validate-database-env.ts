const PLACEHOLDER_MARKERS = [
  '[project-ref]',
  '[password]',
  '[region]',
  'xxxxxxxxxxxx',
];

export function assertDatabaseEnv(): void {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
  const directUrl = process.env.DIRECT_URL?.trim() ?? '';

  const missing: string[] = [];
  if (!databaseUrl) missing.push('DATABASE_URL');
  if (!directUrl) missing.push('DIRECT_URL');
  if (missing.length > 0) {
    throw new Error(
      `Variabel ${missing.join(' dan ')} belum diisi di bedaff/.env`,
    );
  }

  for (const url of [databaseUrl, directUrl]) {
    const hit = PLACEHOLDER_MARKERS.find((m) => url.includes(m));
    if (hit) {
      throw new Error(
        [
          'Connection string database masih placeholder di bedaff/.env.',
          '',
          'Supabase → Project Settings → Database → Connection string:',
          '  • DATABASE_URL = Transaction pooler (port 6543, centang "Use connection pooling")',
          '  • DIRECT_URL   = Direct connection (port 5432)',
          '',
          'Ganti [project-ref], [password], [region] dengan nilai dari dashboard.',
          'Jika password mengandung @ # % dll., URL-encode (encodeURIComponent).',
        ].join('\n'),
      );
    }

    if (!url.startsWith('postgresql://')) {
      throw new Error(
        `Format URL tidak valid (harus diawali postgresql://): ${url.slice(0, 40)}...`,
      );
    }
  }
}
