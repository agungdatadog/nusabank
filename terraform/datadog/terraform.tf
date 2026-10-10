terraform {
  required_version = ">= 1.12.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.28"
    }
    datadog = {
      source  = "DataDog/datadog"
      version = "~> 4.22.0"
    }
  }

  backend "gcs" {
    bucket = "ctf-tfstate-agung"
    prefix = "indowebinar-datadog"
  }
}

provider "google" {
  project = var.project_id
}

# Keys come from Secret Manager at plan time — nothing to export, nothing to paste.
data "google_secret_manager_secret_version" "dd_api_key" {
  secret = "indowebinar-dd-api-key"
}

data "google_secret_manager_secret_version" "dd_app_key" {
  secret = "indowebinar-dd-app-key"
}

provider "datadog" {
  api_url = "https://api.datadoghq.com/"
  api_key = data.google_secret_manager_secret_version.dd_api_key.secret_data
  app_key = data.google_secret_manager_secret_version.dd_app_key.secret_data
}
