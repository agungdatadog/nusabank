# On-Call for Digital Channels, who own nusabank-biller: EP2 Part 1 pages them when a biller fails.
# Monitors page with @oncall-nusabank-channels; the team's routing rules pick the urgency.
data "datadog_user" "on_call" {
  for_each = toset(var.on_call_emails)
  filter   = each.value
  # filter is a substring match; exact_match keeps "ana@" from matching "diana@".
  exact_match = true
}

locals {
  channels_team = datadog_team.nusabank["nusabank-channels"].id
  on_call_users = [for e in var.on_call_emails : data.datadog_user.on_call[e].id]
}

resource "datadog_team_membership" "channels_on_call" {
  for_each = data.datadog_user.on_call
  team_id  = local.channels_team
  user_id  = each.value.id
}

resource "datadog_on_call_schedule" "channels_primary" {
  name      = "Nusa Bank Digital Channels — primary"
  time_zone = "Asia/Jakarta"
  teams     = [local.channels_team]
  layer {
    name           = "Weekly rotation"
    effective_date = "2026-11-16T09:00:00+07:00"
    rotation_start = "2026-11-16T09:00:00+07:00"
    users          = local.on_call_users
    interval {
      days = 7
    }
  }
}

resource "datadog_on_call_escalation_policy" "channels" {
  name    = "Nusa Bank Digital Channels"
  teams   = [local.channels_team]
  retries = 1
  # Primary on-call first; if nobody acknowledges in 5 minutes, the whole team.
  step {
    escalate_after_seconds = 300
    target {
      schedule = datadog_on_call_schedule.channels_primary.id
    }
  }
  step {
    escalate_after_seconds = 600
    target {
      team = local.channels_team
    }
  }
}

resource "datadog_on_call_team_routing_rules" "channels" {
  id = local.channels_team
  # P1/P2 monitors (e.g. "Biller … is failing"): warn pages low urgency, alert pages high.
  rule {
    query = "priority:(1 OR 2)"
    action {
      escalation_policy {
        policy_id = datadog_on_call_escalation_policy.channels.id
        urgency   = "dynamic"
      }
    }
  }
  rule {
    escalation_policy = datadog_on_call_escalation_policy.channels.id
    urgency           = "low"
  }
}
