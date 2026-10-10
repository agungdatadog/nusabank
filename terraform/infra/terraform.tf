terraform {
  required_version = ">= 1.12.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.28"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Shared tfstate bucket with the CTF environments; the prefix keeps Nusa Bank isolated.
  backend "gcs" {
    bucket = "ctf-tfstate-agung"
    prefix = "indowebinar-infra"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = {
    app   = "nusabank"
    env   = var.env
    group = var.name_prefix
  }
}
