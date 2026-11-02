// funding.json - Funding manifest for FLOSS/fund and other funders
// See: https://fundingjson.org/
// The source of truth is funding.json at the repo root, which
// GitHub also serves; this route publishes the same file on www.pvtch.com.

import manifest from '../../../../funding.json';

export function loader() {
  return Response.json(manifest, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
