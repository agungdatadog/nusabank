# Two lines of response, as in a bank's operations: Application Support (part of Operations) is
# first line and gets the monitor's page; after triage it declares an incident and pages the
# owning team (Digital Channels for nusabank-biller) from the incident. EP2 Part 1.
data "datadog_user" "on_call" {
  for_each = toset(var.on_call_emails)
  filter   = each.value
  # filter is a substring match; exact_match keeps "ana@" from matching "diana@".
  exact_match = true
}

resource "datadog_team" "operations" {
  handle      = "nusabank-operations"
  name        = "Nusa Bank Operations"
  description = "Runs the bank day to day: application support, customer care escalations, partner relations"
}

resource "datadog_team" "app_support" {
  handle      = "nusabank-app-support"
  name        = "Nusa Bank Application Support"
  description = "First line, 24/7: receives alerts, triages with runbooks and Bits, declares incidents and pages the owning team"
}

resource "datadog_team_hierarchy_links" "app_support_in_operations" {
  parent_team_id = datadog_team.operations.id
  sub_team_id    = datadog_team.app_support.id
}

locals {
  channels_team    = datadog_team.nusabank["nusabank-channels"].id
  app_support_team = datadog_team.app_support.id
  on_call_users    = [for e in var.on_call_emails : data.datadog_user.on_call[e].id]
}

resource "datadog_team_membership" "channels_on_call" {
  for_each = data.datadog_user.on_call
  team_id  = local.channels_team
  user_id  = each.value.id
}

resource "datadog_team_membership" "app_support_on_call" {
  for_each = data.datadog_user.on_call
  team_id  = local.app_support_team
  user_id  = each.value.id
}

# ───────────── Application Support: first line, paged by monitors ─────────────

resource "datadog_on_call_schedule" "app_support_primary" {
  name      = "Nusa Bank Application Support — 24/7"
  time_zone = "Asia/Jakarta"
  teams     = [local.app_support_team]
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

resource "datadog_on_call_escalation_policy" "app_support" {
  name    = "Nusa Bank Application Support"
  teams   = [local.app_support_team]
  retries = 1
  # Primary first; if nobody acknowledges in 5 minutes, the whole team.
  step {
    escalate_after_seconds = 300
    target {
      schedule = datadog_on_call_schedule.app_support_primary.id
    }
  }
  step {
    escalate_after_seconds = 600
    target {
      team = local.app_support_team
    }
  }
}

resource "datadog_on_call_team_routing_rules" "app_support" {
  id = local.app_support_team
  # P1/P2 monitors (e.g. "Biller … is failing"): warn pages low urgency, alert pages high.
  rule {
    query = "priority:(1 OR 2)"
    action {
      escalation_policy {
        policy_id = datadog_on_call_escalation_policy.app_support.id
        urgency   = "dynamic"
      }
    }
  }
  rule {
    escalation_policy = datadog_on_call_escalation_policy.app_support.id
    urgency           = "low"
  }
}

# ───────────── Digital Channels: owning team, paged from an incident ─────────────

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
  # Monitors page Application Support, not this team; a page here comes from a person in a
  # declared incident, so it is always urgent.
  rule {
    escalation_policy = datadog_on_call_escalation_policy.channels.id
    urgency           = "high"
  }
}
