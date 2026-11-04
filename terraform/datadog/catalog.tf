# Software Catalog: owners, tiers and code locations, so Bits and responders can name who owns
# a failing service and jump to its code. Three teams mirror how a digital bank splits its work.
resource "datadog_team" "nusabank" {
  for_each = {
    "nusabank-payments" = { name = "Nusa Bank Payments", description = "Transfers (BI FAST, SKN, internal) and partner rails" }
    "nusabank-core"     = { name = "Nusa Bank Core Banking", description = "Accounts, holds, ledger and loans" }
    "nusabank-channels" = { name = "Nusa Bank Digital Channels", description = "Web app, login, bills, rewards, chat and back office" }
  }
  handle      = each.key
  name        = each.value.name
  description = each.value.description
}

locals {
  catalog_services = {
    "nusabank-payment"      = { team = "nusabank-payments", tier = "1", lang = "go", path = "payment-service", title = "Payment Service", desc = "Sends transfers over BI FAST, SKN and internal book transfers; holds funds via account-service first." }
    "nusabank-partner-mock" = { team = "nusabank-payments", tier = "2", lang = "go", path = "partner-mock", title = "Partner Rails (BI FAST, SKN, billers)", desc = "Stands in for BI FAST, SKN, billers and the credit bureau." }
    "nusabank-account"      = { team = "nusabank-core", tier = "1", lang = "java", path = "account-service", title = "Account Service", desc = "Accounts, balances and holds; balances are a projection of ledger.posted.v1." }
    "nusabank-ledger"       = { team = "nusabank-core", tier = "1", lang = "java", path = "ledger-worker", title = "Ledger Worker", desc = "Source of truth for journals; consumes payment events from Kafka." }
    "nusabank-loan"         = { team = "nusabank-core", tier = "2", lang = "java", path = "loan-service", title = "Loan Service", desc = "Loan applications and credit bureau checks." }
    "nusabank-frontend"     = { team = "nusabank-channels", tier = "1", lang = "js", path = "frontend", title = "Web App", desc = "Customer web app (React), served same-origin with /api." }
    "nusabank-auth"         = { team = "nusabank-channels", tier = "1", lang = "js", path = "auth-service", title = "Auth Service", desc = "Login, MFA and sessions." }
    "nusabank-biller"       = { team = "nusabank-channels", tier = "2", lang = "js", path = "biller-service", title = "Biller Service", desc = "Bill payments (PLN, Telkomsel and other billers)." }
    "nusabank-rewards"      = { team = "nusabank-channels", tier = "3", lang = "js", path = "rewards-service", title = "Rewards Service", desc = "Points and tiers." }
    "nusabank-chat"         = { team = "nusabank-channels", tier = "3", lang = "js", path = "chat-service", title = "Chat Service", desc = "Customer chat; routes to FAQ or the AI agent." }
    "nusabank-ai-agent"     = { team = "nusabank-channels", tier = "3", lang = "python", path = "ai-agent", title = "AI Assistant", desc = "LLM assistant behind chat." }
    "nusabank-admin"        = { team = "nusabank-channels", tier = "3", lang = "js", path = "admin-service", title = "Back Office", desc = "Operator console API." }
  }
}

resource "datadog_software_catalog" "service" {
  for_each = local.catalog_services

  entity = yamlencode({
    apiVersion = "v3"
    kind       = "service"
    metadata = {
      name        = each.key
      displayName = each.value.title
      description = each.value.desc
      owner       = datadog_team.nusabank[each.value.team].handle
      links = [{
        name     = "Source"
        type     = "repo"
        provider = "github"
        url      = "https://github.com/agungdatadog/nusabank/tree/main/services/${each.value.path}"
      }]
    }
    spec = {
      lifecycle = "production"
      tier      = each.value.tier
      languages = [each.value.lang]
    }
    datadog = {
      codeLocations = [{
        repositoryURL = "https://github.com/agungdatadog/nusabank"
        paths         = ["services/${each.value.path}/**"]
      }]
    }
  })
}
