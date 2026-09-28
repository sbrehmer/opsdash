# Contract: Delivery dashboard configuration

The example ships as `examples/config/dashboards/delivery.yaml`, with the plugin entries in
`examples/config/opsdash.yaml`. It works in mock mode as it stands. For real systems, set the
URLs and the environment variables.

```yaml
plugins:
  jira:
    version: "^1.0.0"
    settings:
      deployment: cloud            # cloud | datacenter
      baseUrl: https://acme.atlassian.net
      email: ops-bot@acme.example
      token: { env: JIRA_TOKEN }
      projectKeys: [PROJ]
  github:
    version: "^1.0.0"
    settings:
      apiUrl: https://api.github.com/graphql   # GHES: https://github.acme.example/api/graphql
      webUrl: https://github.com
      token: { env: GITHUB_TOKEN }
      defaultRepo: acme/web
  jenkins:
    version: "^1.0.0"
    refreshInterval: 60s
    settings:
      baseUrl: https://ci.acme.example
      user: ops-bot
      token: { env: JENKINS_TOKEN }
      pipelines: { "acme/web": "acme/web", "acme/api": "backend/api" }
      pipelineTemplate: "acme/{name}"
      mainBranch: main
      runningRefreshInterval: 10s
  delivery:
    version: "^1.0.0"

dashboards:
  - id: delivery
    title: Delivery
    items:
      - id: tracker
        plugin: delivery
        title: In flight
        at: [1, 1]
        size: [12, 6]
        settings: { retention: 7d }
      - { id: stories, plugin: jira, title: Stories, at: [1, 7], size: [4, 4] }
      - { id: prs, plugin: github, title: Pull requests, at: [5, 7], size: [4, 4] }
      - { id: builds, plugin: jenkins, title: Builds, at: [9, 7], size: [4, 4] }
```
