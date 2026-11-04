# The app is served from <ip>.sslip.io, a domain the SSRF rule sqr-000-014 treats as a
# redirection-bypass host. Every page view sent it in the Referer header, so AAP logged
# ~6,100 false "attack attempts" a week. Exclude only that rule, only for that header.
resource "datadog_appsec_waf_exclusion_filter" "own_referer_ssrf" {
  description = "Nusa Bank: own sslip.io Referer is not an SSRF attempt"
  enabled     = true
  parameters  = ["server.request.headers.no_cookies.referer"]

  rules_target {
    rule_id = "sqr-000-014"
  }

  scope {
    env = "demo"
  }
}
