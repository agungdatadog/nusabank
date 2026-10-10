locals {
  # Database per service: each service gets its own database and user of the same name.
  sql_instances = {
    "pg-core" = {
      version   = "POSTGRES_15"
      databases = ["account", "payment", "ledger"]
    }
    "pg-channel" = {
      version   = "POSTGRES_15"
      databases = ["auth", "loan", "admin"]
    }
    "mysql-partner" = {
      version   = "MYSQL_8_4"
      databases = ["biller", "rewards"]
    }
  }

  # Flags Datadog DBM needs to capture full query text and statistics.
  dbm_flags = {
    postgres = {
      "pg_stat_statements.track"  = "all"
      "pg_stat_statements.max"    = "10000"
      "track_activity_query_size" = "4096"
      "track_io_timing"           = "on"
      # Keep BEGIN/SET/COMMIT out of query metrics (optional step in the DBM Cloud SQL guide).
      "pg_stat_statements.track_utility" = "off"
    }
    mysql = {
      "performance_schema"                     = "on"
      "max_digest_length"                      = "4096"
      "performance_schema_max_digest_length"   = "4096"
      "performance_schema_max_sql_text_length" = "4096"
    }
  }

  service_databases = merge([
    for inst, cfg in local.sql_instances : {
      for db in cfg.databases : db => { instance = inst }
    }
  ]...)
}

resource "google_sql_database_instance" "nusabank" {
  for_each = local.sql_instances

  name             = "${var.name_prefix}-${each.key}"
  region           = var.region
  database_version = each.value.version

  deletion_protection = true

  # Private IP needs the PSA peering in place first.
  depends_on = [google_service_networking_connection.psa]

  settings {
    tier              = var.sql_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 20
    disk_autoresize   = true

    deletion_protection_enabled = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.nusabank.id
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "19:00" # 02:00 WIB
      point_in_time_recovery_enabled = startswith(each.value.version, "POSTGRES")
      binary_log_enabled             = startswith(each.value.version, "MYSQL")
    }

    insights_config {
      query_insights_enabled = true
    }

    dynamic "database_flags" {
      for_each = startswith(each.value.version, "POSTGRES") ? local.dbm_flags.postgres : local.dbm_flags.mysql
      content {
        name  = database_flags.key
        value = database_flags.value
      }
    }

    user_labels = {
      app = "nusabank"
      env = var.env
    }
  }
}

resource "google_sql_database" "service" {
  for_each = local.service_databases

  name     = each.key
  instance = google_sql_database_instance.nusabank[each.value.instance].name
}

resource "random_password" "service" {
  for_each = local.service_databases

  length  = 32
  special = false
}

resource "google_sql_user" "service" {
  for_each = local.service_databases

  name     = each.key
  instance = google_sql_database_instance.nusabank[each.value.instance].name
  password = random_password.service[each.key].result
}

# One DBM monitoring user per instance. Its grants (pg_monitor, performance_schema)
# are applied in SQL by the terraform/k8s bootstrap job, not here.
resource "random_password" "datadog" {
  for_each = local.sql_instances

  length  = 32
  special = false
}

resource "google_sql_user" "datadog" {
  for_each = local.sql_instances

  name     = "datadog"
  instance = google_sql_database_instance.nusabank[each.key].name
  password = random_password.datadog[each.key].result
}

# Admin user for bootstrap jobs only (DBM grants, extensions). Services never use it.
resource "random_password" "dbadmin" {
  for_each = local.sql_instances

  length  = 32
  special = false
}

resource "google_sql_user" "dbadmin" {
  for_each = local.sql_instances

  name     = "dbadmin"
  instance = google_sql_database_instance.nusabank[each.key].name
  password = random_password.dbadmin[each.key].result
}
