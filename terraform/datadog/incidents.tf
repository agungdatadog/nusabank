# Incident Management for a partner outage (EP2 Part 1): a type of its own, so declaring one picks up
# the notification template below and the postmortem template. Declared by Application Support from the Bits investigation on stage.
resource "datadog_incident_type" "partner_outage" {
  name        = "Partner outage"
  description = "An external partner (biller, BI FAST, SKN, credit bureau, FX) fails or slows down. We have no telemetry inside the partner: the evidence is our outbound spans to it."
}

resource "datadog_incident_notification_template" "partner_outage_declared" {
  name          = "Partner outage declared"
  category      = "incident"
  incident_type = datadog_incident_type.partner_outage.id
  subject       = "[{{incident.severity}}] Incident #{{incident.id}}: {{incident.title}}"
  content       = <<-EOT
    **{{incident.title}}** — {{incident.severity}}, {{incident.status}}
    Commander: {{incident.commander}}

    **Customer impact:** {{incident.customer_impact}}

    A partner outage: the failure is outside Nusa Bank. Funds are held before every partner call and
    released when it fails, so no money moves.

    1. Confirm the blast radius: one partner or many (APM → outbound spans grouped by `peer.service`).
    2. Follow the runbook. GoPay: ${local.gopay_runbook} · other partners: ${local.partner_runbook}
    3. Tell Customer Care which product is affected and the message customers see.
    4. Contact the partner's support with the failing time window and sample trace IDs.

    Incidents: https://app.datadoghq.com/incidents
  EOT
}

resource "datadog_incident_notification_rule" "partner_outage_declared" {
  enabled               = true
  incident_type         = datadog_incident_type.partner_outage.id
  trigger               = "incident_created_trigger"
  handles               = [for e in var.on_call_emails : "@${e}"]
  notification_template = datadog_incident_notification_template.partner_outage_declared.id
  renotify_on           = ["status", "severity"]
}

# The postmortem template lives in docs/runbooks/postmortems/partner-outage.md and is applied by
# tools/incidents/postmortem_template.py: provider 4.22 can't read datadog_incident_postmortem_template back.

output "on_call" {
  value = {
    app_support_schedule = datadog_on_call_schedule.app_support_primary.id
    channels_schedule    = datadog_on_call_schedule.channels_primary.id
    network_schedule     = datadog_on_call_schedule.network_primary.id
    incident_type        = datadog_incident_type.partner_outage.id
  }
}
