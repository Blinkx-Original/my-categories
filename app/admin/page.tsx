import ConnectivityPanel, {
  type ConnectivityPanelProps,
} from './connectivity-panel';

import { getAlgoliaConfig } from '@/lib/server/algolia';
import {
  getCloudflareImagesConfig,
} from '@/lib/server/cloudflare/images';
import {
  getCloudflarePurgeConfig,
} from '@/lib/server/cloudflare/purge';
import { getAdminAuthConfig, issueAdminSessionToken } from '@/lib/server/admin/auth';
import { loadTiDbCredentials } from '@/lib/server/tidb/config';

function obfuscateId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value.length <= 6) {
    return value;
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export default async function AdminConnectivityPage() {
  const purgeConfig = getCloudflarePurgeConfig();
  const imagesConfig = getCloudflareImagesConfig();
  const algoliaConfig = getAlgoliaConfig();
  const tidbConfig = loadTiDbCredentials();
  const adminConfig = getAdminAuthConfig();

  const props: ConnectivityPanelProps = {
    sessionToken: adminConfig ? await issueAdminSessionToken(adminConfig) : null,
    cloudflare: {
      hasImagesCredentials: Boolean(imagesConfig),
      hasPurgeCredentials: Boolean(purgeConfig),
      includeProductUrls: purgeConfig?.includeProductUrls ?? false,
      enablePurgeOnPublish: purgeConfig?.enablePurgeOnPublish ?? false,
      zoneIdLabel: obfuscateId(purgeConfig?.zoneId ?? null),
    },
    algoliaConfigured: Boolean(algoliaConfig),
    algoliaIndexName: algoliaConfig?.indexName ?? null,
    tidbConfigured: Boolean(tidbConfig),
  };

  return <ConnectivityPanel {...props} />;
}
