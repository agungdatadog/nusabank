# EP1 Synthetics: customer journeys checked from Jakarta (and Singapore for contrast).
# Browser runs also produce synthetic RUM sessions linked to backend traces (RUM <-> APM).

variable "base_url" {
  type        = string
  description = "Public URL of the demo (Ingress + Google-managed certificate)"
  default     = "https://136-69-32-40.sslip.io"
}

variable "synthetics_username" {
  type        = string
  description = "Seeded customer without MFA (catalog/seed/customers.json)"
  default     = "yusuf.tanjung"
}

locals {
  synthetics_locations = ["aws:ap-southeast-3", "aws:ap-southeast-1"] # Jakarta, Singapore
  synthetics_tags      = ["env:demo", "app:nusabank", "team:indowebinar", "episode:ep1"]
}

data "google_secret_manager_secret_version" "demo_password" {
  secret = "indowebinar-demo-customer-password"
}

resource "datadog_synthetics_global_variable" "demo_password" {
  name        = "NUSABANK_DEMO_PASSWORD"
  description = "Password of the synthetic Nusa Bank customers (Secret Manager: indowebinar-demo-customer-password)"
  tags        = local.synthetics_tags
  value       = data.google_secret_manager_secret_version.demo_password.secret_data
  secure      = true
}

resource "datadog_synthetics_test" "login_journey" {
  name      = "[Nusa Bank] Login → Beranda → Rekening → Transfer"
  type      = "browser"
  status    = "live"
  message   = "Customer login journey is failing from {{location.name}}. Check RUM session and linked APM trace."
  locations = local.synthetics_locations
  tags      = local.synthetics_tags

  device_ids = ["chrome.laptop_large"]

  request_definition {
    method = "GET"
    url    = "${var.base_url}/login"
  }

  # Browser tests declare global variables with browser_variable (config_variable is API-only).
  browser_variable {
    type = "global"
    name = "NUSABANK_DEMO_PASSWORD"
    id   = datadog_synthetics_global_variable.demo_password.id
  }

  browser_step {
    name = "Isi User ID"
    type = "typeText"
    params {
      value = var.synthetics_username
      element_user_locator {
        fail_test_on_cannot_locate = true
        value {
          type  = "css"
          value = "input[autocomplete=username]"
        }
      }
    }
  }

  browser_step {
    name = "Isi kata sandi"
    type = "typeText"
    params {
      value = "{{ NUSABANK_DEMO_PASSWORD }}"
      element_user_locator {
        fail_test_on_cannot_locate = true
        value {
          type  = "css"
          value = "input[autocomplete=current-password]"
        }
      }
    }
  }

  browser_step {
    name = "Klik Masuk"
    type = "click"
    params {
      element_user_locator {
        fail_test_on_cannot_locate = true
        value {
          type  = "css"
          value = "form.login-card button.primary"
        }
      }
    }
  }

  browser_step {
    name = "Beranda menampilkan total saldo"
    type = "assertPageContains"
    params {
      value = "Total saldo"
    }
  }

  browser_step {
    name = "Buka rekening pertama"
    type = "click"
    params {
      element_user_locator {
        fail_test_on_cannot_locate = true
        value {
          type  = "css"
          value = "a.product"
        }
      }
    }
  }

  browser_step {
    name = "Mutasi rekening tampil"
    type = "assertPageContains"
    params {
      value = "Mutasi Rekening"
    }
  }

  browser_step {
    name = "Buka menu Transfer"
    type = "click"
    params {
      element_user_locator {
        fail_test_on_cannot_locate = true
        value {
          type  = "css"
          value = "a[href='/transfer']"
        }
      }
    }
  }

  browser_step {
    name = "Form transfer tampil"
    type = "assertPageContains"
    params {
      value = "BI FAST"
    }
  }

  options_list {
    tick_every          = 300 # every 5 minutes
    min_location_failed = 1
    retry {
      count    = 1
      interval = 30000
    }
    monitor_options {
      renotify_interval = 120
    }
  }
}

resource "datadog_synthetics_test" "api_customer_flow" {
  name      = "[Nusa Bank] API: login → rekening → daftar bank"
  type      = "api"
  subtype   = "multi"
  status    = "live"
  message   = "Nusa Bank customer API flow is failing from {{location.name}}."
  locations = local.synthetics_locations
  tags      = local.synthetics_tags

  config_variable {
    type = "global"
    name = "NUSABANK_DEMO_PASSWORD"
    id   = datadog_synthetics_global_variable.demo_password.id
  }

  api_step {
    name    = "Login"
    subtype = "http"
    request_definition {
      method = "POST"
      url    = "${var.base_url}/api/auth/login"
      body   = jsonencode({ username = var.synthetics_username, password = "{{ NUSABANK_DEMO_PASSWORD }}" })
    }
    request_headers = { "Content-Type" = "application/json" }
    assertion {
      type     = "statusCode"
      operator = "is"
      target   = "200"
    }
    assertion {
      type     = "responseTime"
      operator = "lessThan"
      target   = "1500"
    }
    extracted_value {
      name  = "ACCESS_TOKEN"
      type  = "http_body"
      field = ""
      parser {
        type  = "json_path"
        value = "$.tokens.access_token"
      }
    }
  }

  api_step {
    name    = "Daftar rekening"
    subtype = "http"
    request_definition {
      method = "GET"
      url    = "${var.base_url}/api/accounts"
    }
    request_headers = { "Authorization" = "Bearer {{ ACCESS_TOKEN }}" }
    assertion {
      type     = "statusCode"
      operator = "is"
      target   = "200"
    }
    assertion {
      type     = "responseTime"
      operator = "lessThan"
      target   = "2000"
    }
  }

  api_step {
    name    = "Daftar bank tujuan"
    subtype = "http"
    request_definition {
      method = "GET"
      url    = "${var.base_url}/api/transfers/banks"
    }
    request_headers = { "Authorization" = "Bearer {{ ACCESS_TOKEN }}" }
    assertion {
      type     = "statusCode"
      operator = "is"
      target   = "200"
    }
  }

  options_list {
    tick_every          = 60
    min_location_failed = 1
    retry {
      count    = 1
      interval = 10000
    }
  }
}
