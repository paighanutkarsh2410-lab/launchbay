# [[name]]

[[description]]

Launched with [Launchbay](https://github.com/paighanutkarsh2410-lab/launchbay) from the **Node API** template.

## Run locally

```bash
npm install
npm start
npm test
```

## Delivery

Every push to `main` is tested, scanned with Trivy, built, pushed to GHCR and signed with cosign.
Launchbay's GitOps repo points Argo CD at the image, and the service is served at
`http://[[name]].localtest.me`.
