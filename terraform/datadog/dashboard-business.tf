# EP1 "SEE": one dashboard for the whole bank. The Overview tab shows every layer at once —
# health score and SLOs, monitors, business KPIs, APM, infrastructure, databases, event
# streaming, logs, frontend (RUM), Synthetics, network, security and the AI assistant. The
# other tabs go deep per business line, pairing business metrics (DogStatsD nusabank.*,
# amounts as values in IDR) with the APM view of the services behind them.
# Server-span operations differ per runtime: Go http.request, Node hono.request, Java
# servlet.request. payment-service's http.request also covers its outbound calls, so its
# widgets filter on server resources. Error counts use default_zero(): a healthy service
# emits no error points, which would show as "No data".

locals {
  env = "env:demo"

  # Server endpoints that carry each business flow.
  pay_create  = "service:nusabank-payment,resource_name:post_/api/transfers,env:demo"
  pay_inquiry = "service:nusabank-payment,resource_name:post_/api/transfers/inquiry,env:demo"
  bill_pay    = "service:nusabank-biller,resource_name:post_/api/billers/payments,env:demo"
  bill_inq    = "service:nusabank-biller,resource_name:post_/api/billers/inquiry,env:demo"
  loan_sim    = "service:nusabank-loan,resource_name:post_/api/loans/simulations,env:demo"
  loan_submit = "service:nusabank-loan,resource_name:post_/api/loans/applications/_applicationid_/submit,env:demo"
  login       = "service:nusabank-auth,resource_name:post_/api/auth/login,env:demo"
  # payment-service server requests only (its http.request also covers outbound calls).
  pay_server = "service:nusabank-payment,!resource_name:http.request,env:demo"

  # Digital Banking Health Score: weighted SLO statuses; money-moving journeys weigh most.
  health_weights = [
    { name = "a", weight = 0.30, id = datadog_service_level_objective.journey_availability["transfer"].id, type = "metric" },
    { name = "b", weight = 0.25, id = datadog_service_level_objective.journey_availability["tagihan"].id, type = "metric" },
    { name = "c", weight = 0.15, id = datadog_service_level_objective.journey_availability["login"].id, type = "metric" },
    { name = "d", weight = 0.10, id = datadog_service_level_objective.journey_availability["saldo"].id, type = "metric" },
    { name = "e", weight = 0.10, id = datadog_service_level_objective.journey_latency["transfer"].id, type = "time_slice" },
    { name = "f", weight = 0.10, id = datadog_service_level_objective.journey_latency["tagihan"].id, type = "time_slice" },
  ]
}

resource "datadog_dashboard" "business" {
  title       = "Nusa Bank — Business & Technology Overview"
  description = "EP1 \"SEE\": the whole bank on one dashboard — business value next to the APM, infrastructure, database, streaming, logs, RUM, Synthetics, network, security and AI layers that deliver it. Managed by Terraform (terraform/datadog)."
  layout_type = "ordered"
  reflow_type = "auto"
  tags        = ["team:nusabank"]

  # ═════════════════════════════ TAB 1 · OVERVIEW ═════════════════════════════

  # @1
  widget {
    group_definition {
      title            = "Health at a glance"
      layout_type      = "ordered"
      background_color = "vivid_blue"

      widget {
        query_value_definition {
          title       = "Digital Banking Health Score"
          precision   = 2
          custom_unit = "%"
          request {
            formula {
              formula_expression = join(" + ", [for h in local.health_weights : "${h.weight} * ${h.name}"])
              conditional_formats {
                comparator = ">="
                value      = 99.9
                palette    = "white_on_green"
              }
              conditional_formats {
                comparator = ">="
                value      = 99
                palette    = "white_on_yellow"
              }
              conditional_formats {
                comparator = "<"
                value      = 99
                palette    = "white_on_red"
              }
            }
            dynamic "query" {
              for_each = local.health_weights
              content {
                slo_query {
                  name           = query.value.name
                  data_source    = "slo"
                  slo_id         = query.value.id
                  measure        = "slo_status"
                  slo_query_type = query.value.type
                }
              }
            }
          }
        }
      }
      widget {
        service_level_objective_definition {
          title             = "Critical journeys SLO"
          slo_id            = datadog_service_level_objective.digital_banking.id
          view_type         = "detail"
          view_mode         = "overall"
          time_windows      = ["7d", "30d"]
          show_error_budget = true
        }
      }
      widget {
        manage_status_definition {
          title               = "Monitor status"
          query               = "tag:team:nusabank"
          summary_type        = "monitors"
          display_format      = "counts"
          color_preference    = "background"
          hide_zero_counts    = false
          show_last_triggered = false
          sort                = "status,asc"
        }
      }
      widget {
        query_value_definition {
          title     = "API requests"
          precision = 0
          request {
            q          = "sum:trace.hono.request.hits{${local.env}}.as_count() + sum:trace.servlet.request.hits{${local.env}}.as_count() + sum:trace.http.request.hits{${local.pay_server}}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "API error rate"
          precision   = 3
          custom_unit = "%"
          request {
            q          = "100 * (default_zero(sum:trace.hono.request.errors{${local.env}}.as_count()) + default_zero(sum:trace.servlet.request.errors{${local.env}}.as_count()) + default_zero(sum:trace.http.request.errors{${local.pay_server}}.as_count())) / (sum:trace.hono.request.hits{${local.env}}.as_count() + sum:trace.servlet.request.hits{${local.env}}.as_count() + sum:trace.http.request.hits{${local.pay_server}}.as_count())"
            aggregator = "sum"
            conditional_formats {
              comparator = "<"
              value      = 1
              palette    = "white_on_green"
            }
            conditional_formats {
              comparator = ">="
              value      = 1
              palette    = "white_on_red"
            }
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Transfer submission p95"
          precision   = 0
          custom_unit = "ms"
          request {
            q          = "1000 * p95:trace.http.request{${local.pay_create}}"
            aggregator = "avg"
            conditional_formats {
              comparator = "<"
              value      = 1000
              palette    = "white_on_green"
            }
            conditional_formats {
              comparator = ">="
              value      = 1000
              palette    = "white_on_yellow"
            }
          }
        }
      }
    }
  }

  # @2
  widget {
    group_definition {
      title            = "Business KPIs"
      layout_type      = "ordered"
      background_color = "vivid_green"

      widget {
        query_value_definition {
          title       = "Outgoing transfer value"
          precision   = 0
          custom_unit = "Rp"
          request {
            q          = "sum:nusabank.transfer.amount{${local.env},status:success}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title     = "Transfers"
          precision = 0
          request {
            q          = "sum:nusabank.transfer.count{${local.env}}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Top-up & bill payment value"
          precision   = 0
          custom_unit = "Rp"
          request {
            q          = "sum:nusabank.biller.payment.amount{${local.env},status:success}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Loan principal applied"
          precision   = 0
          custom_unit = "Rp"
          request {
            q          = "sum:nusabank.loan.application.amount{${local.env},stage:submitted}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title     = "New accounts approved"
          precision = 0
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:approved}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Transactions per minute — transfers vs top-ups & bills"
          show_legend = true
          request {
            q            = "sum:nusabank.transfer.count{${local.env}}.as_count().rollup(sum, 60)"
            display_type = "bars"
            metadata {
              expression = "sum:nusabank.transfer.count{${local.env}}.as_count().rollup(sum, 60)"
              alias_name = "Transfers"
            }
          }
          request {
            q            = "sum:nusabank.biller.payment.count{${local.env}}.as_count().rollup(sum, 60)"
            display_type = "bars"
            metadata {
              expression = "sum:nusabank.biller.payment.count{${local.env}}.as_count().rollup(sum, 60)"
              alias_name = "Top-ups & bills"
            }
          }
        }
      }
      widget {
        sunburst_definition {
          title = "Transfer value by rail (Rp)"
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              metric_query {
                name        = "query1"
                data_source = "metrics"
                query       = "sum:nusabank.transfer.amount{${local.env},status:success} by {rail}.as_count()"
                aggregator  = "sum"
              }
            }
          }
        }
      }
      widget {
        sunburst_definition {
          title = "Top-ups & bills by category"
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              metric_query {
                name        = "query1"
                data_source = "metrics"
                query       = "sum:nusabank.biller.payment.count{${local.env}} by {category}.as_count()"
                aggregator  = "sum"
              }
            }
          }
        }
      }
      widget {
        toplist_definition {
          title = "Failed top-ups & bills by biller"
          request {
            q = "top(sum:nusabank.biller.payment.count{${local.env},status:failed} by {biller}.as_count(), 10, 'sum', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Failed transfers by rail"
          request {
            q = "top(sum:nusabank.transfer.count{${local.env},status:failed} by {rail}.as_count(), 5, 'sum', 'desc')"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Loan approval rate"
          custom_unit = "%"
          precision   = 1
          request {
            q          = "100 * sum:nusabank.loan.application.count{${local.env},stage:approved}.as_count() / (sum:nusabank.loan.application.count{${local.env},stage:approved}.as_count() + sum:nusabank.loan.application.count{${local.env},stage:rejected}.as_count())"
            aggregator = "sum"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Average transfer value by rail (Rp)"
          request {
            q = "top(avg:nusabank.transfer.amount{${local.env},status:success} by {rail}, 5, 'mean', 'desc')"
          }
        }
      }
    }
  }

  # @3
  widget {
    group_definition {
      title            = "APM — services and dependencies"
      layout_type      = "ordered"
      background_color = "vivid_purple"

      widget {
        servicemap_definition {
          title   = "payment-service map"
          service = "nusabank-payment"
          filters = ["env:demo"]
        }
      }
      widget {
        timeseries_definition {
          title       = "Requests by service and version"
          show_legend = true
          request {
            q            = "sum:trace.hono.request.hits{${local.env}} by {service,version}.as_count()"
            display_type = "bars"
          }
          request {
            q            = "sum:trace.servlet.request.hits{${local.env}} by {service,version}.as_count()"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Errors by service"
          show_legend = true
          request {
            q            = "default_zero(sum:trace.hono.request.errors{${local.env}} by {service}.as_count())"
            display_type = "bars"
          }
          request {
            q            = "default_zero(sum:trace.servlet.request.errors{${local.env}} by {service}.as_count())"
            display_type = "bars"
          }
          request {
            q            = "default_zero(sum:trace.http.request.errors{${local.pay_server}} by {service}.as_count())"
            display_type = "bars"
          }
        }
      }
      widget {
        toplist_definition {
          title = "p95 latency by endpoint — Node services"
          request {
            q = "top(p95:trace.hono.request{${local.env}} by {service,resource_name}, 10, 'mean', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Third-party p95 latency — PPOB billers"
          request {
            q = "top(p95:trace.ppob.request{${local.env}} by {peer.service}, 16, 'mean', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Third-party error rate (%)"
          show_legend = true
          request {
            q            = "100 * default_zero(sum:trace.ppob.request.errors{${local.env}} by {peer.service}.as_count()) / sum:trace.ppob.request.hits{${local.env}} by {peer.service}.as_count()"
            display_type = "line"
          }
          request {
            q            = "100 * default_zero(sum:trace.partner.request.errors{${local.env}} by {peer.service}.as_count()) / sum:trace.partner.request.hits{${local.env}} by {peer.service}.as_count()"
            display_type = "line"
          }
        }
      }
      widget {
        query_table_definition {
          title = "Service health — Apdex"
          request {
            q          = "avg:trace.servlet.request.apdex{${local.env}} by {service}"
            aggregator = "avg"
            alias      = "Apdex (Java)"
          }
          request {
            q          = "avg:trace.hono.request.apdex{${local.env}} by {service}"
            aggregator = "avg"
            alias      = "Apdex (Node)"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Error spans by service, incl. outbound calls"
          custom_link {
            label = "Open error traces"
            link  = "/apm/traces?query=env%3Ademo%20service%3Anusabank-%2A%20status%3Aerror"
          }
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "spans"
                indexes     = ["*"]
                compute {
                  aggregation = "count"
                }
                search {
                  query = "env:demo service:nusabank-* status:error"
                }
                group_by {
                  facet = "service"
                  limit = 10
                  sort {
                    aggregation = "count"
                    order       = "desc"
                  }
                }
              }
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Error Tracking — backend issues"
          request {
            response_format = "event_list"
            query {
              data_source  = "apm_issue_stream"
              query_string = "env:demo service:nusabank-*"
            }
            columns {
              field = "details"
              width = "auto"
            }
            columns {
              field = "count"
              width = "auto"
            }
            columns {
              field = "volume"
              width = "auto"
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Recent error traces"
          request {
            response_format = "event_list"
            query {
              data_source  = "trace_stream"
              query_string = "env:demo service:nusabank-* status:error"
            }
            columns {
              field = "timestamp"
              width = "auto"
            }
            columns {
              field = "service"
              width = "auto"
            }
            columns {
              field = "resource_name"
              width = "auto"
            }
            columns {
              field = "@duration"
              width = "auto"
            }
            columns {
              field = "@http.status_code"
              width = "auto"
            }
          }
        }
      }
    }
  }

  # @4
  widget {
    group_definition {
      title            = "Infrastructure — GKE indowebinar-gke"
      layout_type      = "ordered"
      background_color = "vivid_yellow"

      widget {
        timeseries_definition {
          title       = "Node CPU utilization (%)"
          show_legend = true
          request {
            q            = "100 - avg:system.cpu.idle{kube_cluster_name:indowebinar-gke} by {host}"
            display_type = "line"
          }
          yaxis {
            min = "0"
            max = "100"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "CPU by deployment (cores)"
          show_legend = false
          request {
            q            = "sum:kubernetes.cpu.usage.total{kube_namespace:nusabank} by {kube_deployment} / 1000000000"
            display_type = "area"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Memory by deployment"
          show_legend = false
          request {
            q            = "sum:kubernetes.memory.usage{kube_namespace:nusabank} by {kube_deployment}"
            display_type = "area"
          }
        }
      }
      widget {
        query_value_definition {
          title     = "Pods ready"
          precision = 0
          request {
            q          = "sum:kubernetes_state.pod.ready{kube_namespace:nusabank}"
            aggregator = "last"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Container restarts by deployment"
          request {
            q = "top(sum:kubernetes.containers.restarts{kube_namespace:nusabank} by {kube_deployment}, 10, 'max', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "CPU usage vs limit by deployment (%)"
          request {
            q = "top(100 * sum:kubernetes.cpu.usage.total{kube_namespace:nusabank} by {kube_deployment} / sum:kubernetes.cpu.limits{kube_namespace:nusabank} by {kube_deployment} / 1000000000, 10, 'mean', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Memory working set vs limit by deployment (%)"
          request {
            q = "top(100 * sum:kubernetes.memory.working_set{kube_namespace:nusabank} by {kube_deployment} / sum:kubernetes.memory.limits{kube_namespace:nusabank} by {kube_deployment}, 10, 'mean', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "CPU throttling by deployment (s)"
          show_legend = true
          request {
            q            = "sum:kubernetes.cpu.cfs.throttled.seconds{kube_namespace:nusabank} by {kube_deployment}"
            display_type = "line"
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Kubernetes events — nusabank"
          request {
            response_format = "event_list"
            query {
              data_source  = "event_stream"
              query_string = "source:kubernetes kube_namespace:nusabank"
              event_size   = "s"
            }
            columns {
              field = "details"
              width = "auto"
            }
          }
        }
      }
    }
  }

  # @5
  widget {
    group_definition {
      title            = "Databases — Postgres, MySQL, MongoDB (DBM)"
      layout_type      = "ordered"
      background_color = "vivid_orange"

      widget {
        timeseries_definition {
          title       = "Postgres queries per instance"
          show_legend = true
          request {
            q            = "sum:postgresql.queries.count{*} by {dbinstance}.as_rate()"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Postgres connections"
          show_legend = true
          request {
            q            = "avg:postgresql.connections{*} by {dbinstance}"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "MySQL queries & connections (partner DB)"
          show_legend = true
          request {
            q            = "avg:mysql.performance.queries{*} by {dbinstance}"
            display_type = "line"
          }
          request {
            q            = "avg:mysql.net.connections{*} by {dbinstance}"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "MongoDB operations & connections (chat)"
          show_legend = true
          request {
            q            = "avg:mongodb.opcounters.queryps{*}"
            display_type = "line"
            metadata {
              expression = "avg:mongodb.opcounters.queryps{*}"
              alias_name = "queries/s"
            }
          }
          request {
            q            = "avg:mongodb.connections.current{*}"
            display_type = "line"
            metadata {
              expression = "avg:mongodb.connections.current{*}"
              alias_name = "connections"
            }
          }
        }
      }
      widget {
        toplist_definition {
          title = "Cloud SQL CPU utilization (%)"
          request {
            q = "top(100 * avg:gcp.cloudsql.database.cpu.utilization{database_id:datadog-ese-sandbox:indowebinar-*} by {database_id}, 5, 'mean', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Postgres buffer cache hit (%)"
          show_legend = true
          custom_link {
            label = "Open Database Monitoring"
            link  = "/databases"
          }
          request {
            q            = "100 * avg:postgresql.buffer_hit{*} by {dbinstance} / (avg:postgresql.buffer_hit{*} by {dbinstance} + avg:postgresql.disk_read{*} by {dbinstance})"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Postgres locks & deadlocks"
          show_legend = true
          request {
            q            = "max:postgresql.locks{*} by {dbinstance}"
            display_type = "line"
          }
          request {
            q            = "default_zero(sum:postgresql.deadlocks{*})"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "MySQL slow queries & InnoDB buffer pool (%)"
          show_legend = true
          request {
            q            = "avg:mysql.performance.slow_queries{*}"
            display_type = "line"
          }
          request {
            q            = "100 * avg:mysql.innodb.buffer_pool_utilization{*}"
            display_type = "line"
          }
        }
      }
    }
  }

  # @6
  widget {
    group_definition {
      title            = "Event streaming — Kafka (Data Streams Monitoring)"
      layout_type      = "ordered"
      background_color = "vivid_pink"

      widget {
        timeseries_definition {
          title       = "Consumer lag (s) by consumer group"
          show_legend = true
          request {
            q            = "max:data_streams.kafka.lag_seconds{${local.env}} by {consumer_group}"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "End-to-end pipeline latency"
          show_legend = true
          request {
            q            = "avg:data_streams.latency{${local.env}} by {pathway_type}"
            display_type = "line"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Messages by topic"
          request {
            q = "top(count:data_streams.payload_size{${local.env}} by {topic}.as_count(), 10, 'sum', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Consumer lag (messages) by topic"
          show_legend = true
          custom_link {
            label = "Open Data Streams"
            link  = "/data-streams"
          }
          request {
            q            = "max:data_streams.kafka.lag_messages{${local.env}} by {topic}"
            display_type = "line"
          }
        }
      }
      widget {
        query_table_definition {
          title = "Consumer lag by group and topic"
          request {
            q          = "max:data_streams.kafka.lag_seconds{${local.env}} by {consumer_group,topic}"
            aggregator = "max"
            alias      = "Lag (s)"
          }
          request {
            q          = "max:data_streams.kafka.lag_messages{${local.env}} by {consumer_group,topic}"
            aggregator = "max"
            alias      = "Lag (messages)"
          }
        }
      }
    }
  }

  # @7
  widget {
    group_definition {
      title            = "Logs — application services"
      layout_type      = "ordered"
      background_color = "vivid_green"

      widget {
        timeseries_definition {
          title       = "Log volume by service"
          show_legend = false
          request {
            display_type = "bars"
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "logs"
                indexes     = ["*"]
                compute {
                  aggregation = "count"
                }
                search {
                  query = "env:demo service:nusabank-*"
                }
                group_by {
                  facet = "service"
                  limit = 15
                  sort {
                    aggregation = "count"
                    order       = "desc"
                  }
                }
              }
            }
          }
        }
      }
      widget {
        log_stream_definition {
          title               = "Application warnings and errors"
          query               = "env:demo service:nusabank-* status:(warn OR error)"
          indexes             = ["*"]
          columns             = ["service", "host"]
          show_date_column    = true
          show_message_column = true
          message_display     = "expanded-md"
          sort {
            column = "time"
            order  = "desc"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Error logs by service"
          show_legend = true
          custom_link {
            label = "Open error logs"
            link  = "/logs?query=env%3Ademo%20service%3Anusabank-%2A%20status%3Aerror"
          }
          request {
            display_type = "bars"
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "logs"
                indexes     = ["*"]
                compute {
                  aggregation = "count"
                }
                search {
                  query = "env:demo service:nusabank-* status:error"
                }
                group_by {
                  facet = "service"
                  limit = 15
                  sort {
                    aggregation = "count"
                    order       = "desc"
                  }
                }
              }
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Warning & error log patterns"
          request {
            response_format = "event_list"
            query {
              data_source  = "logs_pattern_stream"
              query_string = "env:demo service:nusabank-* status:(warn OR error)"
            }
            columns {
              field = "status_line"
              width = "auto"
            }
            columns {
              field = "service"
              width = "auto"
            }
            columns {
              field = "volume_sparkline"
              width = "auto"
            }
          }
        }
      }
    }
  }

  # @8
  widget {
    group_definition {
      title            = "Frontend — Real User Monitoring"
      layout_type      = "ordered"
      background_color = "vivid_blue"

      widget {
        query_value_definition {
          title     = "Sessions"
          precision = 0
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                compute {
                  aggregation = "count"
                }
                search {
                  query = "@type:session"
                }
              }
            }
          }
        }
      }
      widget {
        query_value_definition {
          title     = "Sessions with a known customer"
          precision = 0
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                compute {
                  aggregation = "count"
                }
                search {
                  query = "@type:session @usr.id:*"
                }
              }
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Page views by page"
          show_legend = true
          request {
            display_type = "bars"
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                compute {
                  aggregation = "count"
                }
                search {
                  query = "@type:view"
                }
                group_by {
                  facet = "@view.url_path_group"
                  limit = 8
                  sort {
                    aggregation = "count"
                    order       = "desc"
                  }
                }
              }
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Page load time p75"
          show_legend = false
          request {
            display_type = "line"
            formula {
              formula_expression = "query1 / 1000000000"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                compute {
                  aggregation = "pc75"
                  metric      = "@view.loading_time"
                }
                search {
                  query = "@type:view"
                }
              }
            }
          }
        }
      }
      widget {
        toplist_definition {
          title = "Sessions by customer segment"
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                compute {
                  aggregation = "count"
                }
                search {
                  query = "@type:session @usr.segment:*"
                }
                group_by {
                  facet = "@usr.segment"
                  limit = 5
                  sort {
                    aggregation = "count"
                    order       = "desc"
                  }
                }
              }
            }
          }
        }
      }
      widget {
        query_value_definition {
          title     = "Frontend errors"
          precision = 0
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                compute {
                  aggregation = "count"
                }
                search {
                  query = "@type:error"
                }
              }
            }
          }
        }
      }
      widget {
        query_value_definition {
          title     = "LCP p75 (s)"
          precision = 0
          request {
            formula {
              formula_expression = "query1 / 1000000000"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                indexes     = ["*"]
                compute {
                  aggregation = "pc75"
                  metric      = "@view.largest_contentful_paint"
                }
                search {
                  query = "@type:view"
                }
              }
            }
          }
        }
      }
      widget {
        query_value_definition {
          title     = "INP p75 (ms)"
          precision = 0
          request {
            formula {
              formula_expression = "query1 / 1000000"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                indexes     = ["*"]
                compute {
                  aggregation = "pc75"
                  metric      = "@view.interaction_to_next_paint"
                }
                search {
                  query = "@type:view"
                }
              }
            }
          }
        }
      }
      widget {
        query_value_definition {
          title     = "CLS p75"
          precision = 0
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                indexes     = ["*"]
                compute {
                  aggregation = "pc75"
                  metric      = "@view.cumulative_layout_shift"
                }
                search {
                  query = "@type:view"
                }
              }
            }
          }
        }
      }
      widget {
        toplist_definition {
          title = "Slowest pages — load time p75 (ms)"
          request {
            formula {
              formula_expression = "query1 / 1000000"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                indexes     = ["*"]
                compute {
                  aggregation = "pc75"
                  metric      = "@view.loading_time"
                }
                search {
                  query = "@type:view"
                }
                group_by {
                  facet = "@view.url_path_group"
                  limit = 8
                  sort {
                    aggregation = "pc75"
                    order       = "desc"
                    metric      = "@view.loading_time"
                  }
                }
              }
            }
          }
        }
      }
      widget {
        toplist_definition {
          title = "Failed API calls from the browser"
          custom_link {
            label = "Open RUM resources"
            link  = "/rum/sessions?query=%40type%3Aresource%20%40resource.status_code%3A%3E%3D400"
          }
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "rum"
                indexes     = ["*"]
                compute {
                  aggregation = "count"
                }
                search {
                  query = "@type:resource @resource.status_code:>=400"
                }
                group_by {
                  facet = "@resource.url_path"
                  limit = 8
                  sort {
                    aggregation = "count"
                    order       = "desc"
                  }
                }
              }
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Frontend Error Tracking issues"
          request {
            response_format = "event_list"
            query {
              data_source  = "rum_issue_stream"
              query_string = ""
            }
            columns {
              field = "details"
              width = "auto"
            }
            columns {
              field = "count"
              width = "auto"
            }
            columns {
              field = "volume"
              width = "auto"
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Recent customer sessions — click to replay"
          request {
            response_format = "event_list"
            query {
              data_source  = "rum_stream"
              query_string = "@type:session @usr.id:*"
            }
            columns {
              field = "timestamp"
              width = "auto"
            }
            columns {
              field = "@usr.name"
              width = "auto"
            }
            columns {
              field = "@usr.id"
              width = "auto"
            }
            columns {
              field = "@usr.segment"
              width = "auto"
            }
            columns {
              field = "@session.view.count"
              width = "auto"
            }
            columns {
              field = "@geo.country"
              width = "auto"
            }
          }
        }
      }
    }
  }

  # @9
  widget {
    group_definition {
      title            = "Synthetics, network and edge"
      layout_type      = "ordered"
      background_color = "vivid_purple"

      widget {
        timeseries_definition {
          title       = "Synthetic API response time by location"
          show_legend = true
          request {
            q            = "avg:synthetics.http.response.time{*} by {location}"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Synthetic test runs by status"
          show_legend = true
          request {
            q            = "sum:synthetics.test_runs{*} by {status}.as_count()"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Load balancer requests (HTTPS)"
          show_legend = false
          request {
            q            = "sum:gcp.loadbalancing.https.request_count{*}.as_count()"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Network received by deployment (bytes/s)"
          show_legend = false
          request {
            q            = "sum:kubernetes.network.rx_bytes{kube_namespace:nusabank} by {kube_deployment}"
            display_type = "area"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Synthetic test runs by test"
          custom_link {
            label = "Open Synthetics"
            link  = "/synthetics/tests"
          }
          request {
            q = "top(sum:synthetics.test_runs{*} by {test_name}.as_count(), 10, 'sum', 'desc')"
          }
        }
      }
    }
  }

  # @10
  widget {
    group_definition {
      title            = "Security and AI assistant"
      layout_type      = "ordered"
      background_color = "vivid_orange"

      widget {
        timeseries_definition {
          title       = "App & API Protection — security events by service"
          show_legend = true
          request {
            display_type = "bars"
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "spans"
                compute {
                  aggregation = "count"
                }
                search {
                  query = "env:demo @appsec.event:true"
                }
                group_by {
                  facet = "service"
                  limit = 10
                  sort {
                    aggregation = "count"
                    order       = "desc"
                  }
                }
              }
            }
          }
        }
      }
      widget {
        query_value_definition {
          title     = "AI assistant conversations (LLM Observability)"
          precision = 0
          request {
            q          = "sum:ml_obs.trace{ml_app:nusabank-assistant}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "AI assistant turn duration"
          show_legend = false
          request {
            q            = "avg:ml_obs.trace.duration{ml_app:nusabank-assistant}"
            display_type = "line"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Attack attempts by source IP"
          custom_link {
            label = "Open App & API Protection"
            link  = "/security/appsec/traces?query=env%3Ademo"
          }
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "spans"
                indexes     = ["*"]
                compute {
                  aggregation = "count"
                }
                search {
                  query = "env:demo @appsec.event:true"
                }
                group_by {
                  facet = "@http.client_ip"
                  limit = 10
                  sort {
                    aggregation = "count"
                    order       = "desc"
                  }
                }
              }
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "LLM call latency p95 (Anthropic)"
          show_legend = true
          custom_link {
            label = "Open LLM Observability"
            link  = "/llm/traces?query=%40ml_app%3Anusabank-assistant"
          }
          request {
            q            = "p95:trace.anthropic.request{${local.env}}"
            display_type = "line"
          }
        }
      }
      widget {
        toplist_definition {
          title = "AI assistant steps & tools"
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "spans"
                indexes     = ["*"]
                compute {
                  aggregation = "count"
                }
                search {
                  query = "env:demo service:nusabank-ai-agent"
                }
                group_by {
                  facet = "resource_name"
                  limit = 10
                  sort {
                    aggregation = "count"
                    order       = "desc"
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  # ═════════════════════════════ TAB 2 · TRANSFERS ═════════════════════════════

  # @11
  widget {
    group_definition {
      title       = "Transfers — business"
      layout_type = "ordered"

      widget {
        query_value_definition {
          title       = "Transfer value"
          precision   = 0
          custom_unit = "Rp"
          request {
            q          = "sum:nusabank.transfer.amount{${local.env},status:success}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title     = "Transfers"
          precision = 0
          request {
            q          = "sum:nusabank.transfer.count{${local.env}}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Average transfer"
          precision   = 0
          custom_unit = "Rp"
          request {
            q          = "sum:nusabank.transfer.amount{${local.env},status:success}.as_count() / sum:nusabank.transfer.count{${local.env},status:success}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Money in (incoming transfers)"
          precision   = 0
          custom_unit = "Rp"
          request {
            q          = "sum:nusabank.transfer.inbound.amount{${local.env}}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Transfer success rate"
          precision   = 2
          custom_unit = "%"
          request {
            q          = "100 * sum:nusabank.transfer.count{${local.env},status:success}.as_count() / sum:nusabank.transfer.count{${local.env}}.as_count()"
            aggregator = "sum"
            conditional_formats {
              comparator = ">="
              value      = 99
              palette    = "white_on_green"
            }
            conditional_formats {
              comparator = "<"
              value      = 99
              palette    = "white_on_red"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Transfers by rail (per hour)"
          show_legend = true
          request {
            q            = "sum:nusabank.transfer.count{${local.env}} by {rail}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Transfer value by rail (Rp per hour)"
          show_legend = true
          request {
            q            = "sum:nusabank.transfer.amount{${local.env},status:success} by {rail}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Destination banks — transfer count (BI FAST & SKN)"
          request {
            q = "top(sum:nusabank.transfer.count{${local.env},!rail:intrabank} by {destination_bank}.as_count(), 12, 'sum', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Destination banks — transfer value (Rp)"
          request {
            q = "top(sum:nusabank.transfer.amount{${local.env},status:success,!rail:intrabank} by {destination_bank}.as_count(), 12, 'sum', 'desc')"
          }
        }
      }
      widget {
        query_table_definition {
          title = "By rail: transfers, value, success rate"
          request {
            q          = "sum:nusabank.transfer.count{${local.env}} by {rail}.as_count()"
            aggregator = "sum"
            alias      = "Transfers"
          }
          request {
            q          = "sum:nusabank.transfer.amount{${local.env},status:success} by {rail}.as_count()"
            aggregator = "sum"
            alias      = "Value (Rp)"
          }
          request {
            q          = "100 * sum:nusabank.transfer.count{${local.env},status:success} by {rail}.as_count() / sum:nusabank.transfer.count{${local.env}} by {rail}.as_count()"
            aggregator = "sum"
            alias      = "Success (%)"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Money out vs money in (Rp per hour)"
          show_legend = true
          request {
            q            = "sum:nusabank.transfer.amount{${local.env},status:success}.as_count().rollup(sum, 3600)"
            display_type = "bars"
            metadata {
              expression = "sum:nusabank.transfer.amount{${local.env},status:success}.as_count().rollup(sum, 3600)"
              alias_name = "Outgoing"
            }
            style {
              palette = "warm"
            }
          }
          request {
            q            = "sum:nusabank.transfer.inbound.amount{${local.env}}.as_count().rollup(sum, 3600)"
            display_type = "bars"
            metadata {
              expression = "sum:nusabank.transfer.inbound.amount{${local.env}}.as_count().rollup(sum, 3600)"
              alias_name = "Incoming"
            }
            style {
              palette = "cool"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Incoming transfers by rail (per hour)"
          show_legend = true

          request {
            q            = "sum:nusabank.transfer.inbound.count{${local.env}} by {rail}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Failed transfers by rail"
          request {
            q = "top(sum:nusabank.transfer.count{${local.env},status:failed} by {rail}.as_count(), 5, 'sum', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Failed transfers by destination bank"
          request {
            q = "top(sum:nusabank.transfer.count{${local.env},status:failed} by {destination_bank}.as_count(), 10, 'sum', 'desc')"
          }
        }
      }
    }
  }

  # @12
  widget {
    group_definition {
      title       = "Transfers — technology (payment-service, BI FAST, SKN)"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Transfers submitted per second (TPS)"
          show_legend = false
          request {
            q            = "sum:trace.http.request.hits{${local.pay_create}}.as_rate()"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Transfer submission & inquiry latency"
          show_legend = true
          request {
            q            = "avg:trace.http.request{${local.pay_create}}"
            display_type = "line"
            metadata {
              expression = "avg:trace.http.request{${local.pay_create}}"
              alias_name = "Submit — avg"
            }
          }
          request {
            q            = "p95:trace.http.request{${local.pay_create}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.http.request{${local.pay_create}}"
              alias_name = "Submit — p95"
            }
          }
          request {
            q            = "p95:trace.http.request{${local.pay_inquiry}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.http.request{${local.pay_inquiry}}"
              alias_name = "Beneficiary inquiry — p95"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Transfer submission error rate (%)"
          show_legend = false
          request {
            q            = "100 * default_zero(sum:trace.http.request.errors{${local.pay_create}}.as_count()) / sum:trace.http.request.hits{${local.pay_create}}.as_count()"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Rail p95 latency: BI FAST & SKN"
          show_legend = true
          request {
            q            = "p95:trace.partner.request{${local.env},!peer.service:credit-bureau} by {peer.service}"
            display_type = "line"
          }
        }
      }
      widget {
        trace_service_definition {
          title              = "payment-service — service summary"
          env                = "demo"
          service            = "nusabank-payment"
          span_name          = "http.request"
          show_hits          = true
          show_errors        = true
          show_latency       = true
          show_breakdown     = true
          show_distribution  = true
          show_resource_list = true
          size_format        = "medium"
          display_format     = "three_column"
        }
      }
      widget {
        timeseries_definition {
          title       = "Fund hold before the rail (account-service)"
          show_legend = true

          request {
            q            = "p95:trace.servlet.request{service:nusabank-account,resource_name:post_/internal/accounts/_accountnumber_/holds,env:demo}"
            display_type = "line"
            metadata {
              expression = "p95:trace.servlet.request{service:nusabank-account,resource_name:post_/internal/accounts/_accountnumber_/holds,env:demo}"
              alias_name = "Hold — p95"
            }
          }
          request {
            q            = "sum:trace.servlet.request.hits{service:nusabank-account,resource_name:post_/internal/accounts/_accountnumber_/holds,env:demo}.as_rate()"
            display_type = "bars"
            metadata {
              expression = "sum:trace.servlet.request.hits{service:nusabank-account,resource_name:post_/internal/accounts/_accountnumber_/holds,env:demo}.as_rate()"
              alias_name = "Holds / s"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Balance update lag — ledger.posted.v1 to account-service (s)"
          show_legend = true
          custom_link {
            label = "Open Data Streams"
            link  = "/data-streams"
          }

          request {
            q            = "max:data_streams.kafka.lag_seconds{${local.env},consumer_group:account-service} by {topic}"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Rail error rate: BI FAST & SKN (%)"
          show_legend = true

          request {
            q            = "100 * default_zero(sum:trace.partner.request.errors{${local.env},!peer.service:credit-bureau} by {peer.service}.as_count()) / sum:trace.partner.request.hits{${local.env},!peer.service:credit-bureau} by {peer.service}.as_count()"
            display_type = "line"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Operator retries by outcome (/ops)"
          request {
            q = "top(sum:nusabank.admin.transfer_retry.count{${local.env}} by {outcome}.as_count(), 5, 'sum', 'desc')"
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Recent payment-service error traces"
          request {
            response_format = "event_list"
            query {
              data_source  = "trace_stream"
              query_string = "env:demo service:nusabank-payment status:error"
            }
            columns {
              field = "timestamp"
              width = "auto"
            }
            columns {
              field = "resource_name"
              width = "auto"
            }
            columns {
              field = "@duration"
              width = "auto"
            }
            columns {
              field = "@http.status_code"
              width = "auto"
            }
            columns {
              field = "@error.type"
              width = "auto"
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Error Tracking — payment-service"
          request {
            response_format = "event_list"
            query {
              data_source  = "apm_issue_stream"
              query_string = "env:demo service:nusabank-payment"
            }
            columns {
              field = "details"
              width = "auto"
            }
            columns {
              field = "count"
              width = "auto"
            }
            columns {
              field = "volume"
              width = "auto"
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "payment-service warnings & errors"
          request {
            response_format = "event_list"
            query {
              data_source  = "logs_stream"
              query_string = "env:demo service:nusabank-payment status:(warn OR error)"
            }
            columns {
              field = "timestamp"
              width = "auto"
            }
            columns {
              field = "status"
              width = "auto"
            }
            columns {
              field = "message"
              width = "auto"
            }
          }
        }
      }
    }
  }

  # ═════════════════════════════ TAB 3 · PAYMENTS & TOP-UPS ═════════════════════════════

  # @13
  widget {
    group_definition {
      title       = "Payments & top-ups — business"
      layout_type = "ordered"

      widget {
        query_value_definition {
          title       = "Top-up & bill value"
          precision   = 0
          custom_unit = "Rp"
          request {
            q          = "sum:nusabank.biller.payment.amount{${local.env},status:success}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title     = "Transactions"
          precision = 0
          request {
            q          = "sum:nusabank.biller.payment.count{${local.env}}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Average ticket"
          precision   = 0
          custom_unit = "Rp"
          request {
            q          = "sum:nusabank.biller.payment.amount{${local.env},status:success}.as_count() / sum:nusabank.biller.payment.count{${local.env},status:success}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "E-wallet top-up value"
          precision   = 0
          custom_unit = "Rp"
          request {
            q          = "sum:nusabank.biller.payment.amount{${local.env},status:success,category:ewallet}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Payment success rate"
          precision   = 2
          custom_unit = "%"
          request {
            q          = "100 * sum:nusabank.biller.payment.count{${local.env},status:success}.as_count() / sum:nusabank.biller.payment.count{${local.env}}.as_count()"
            aggregator = "sum"
            conditional_formats {
              comparator = ">="
              value      = 98
              palette    = "white_on_green"
            }
            conditional_formats {
              comparator = "<"
              value      = 98
              palette    = "white_on_red"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Transactions by category (per hour)"
          show_legend = true
          request {
            q            = "sum:nusabank.biller.payment.count{${local.env}} by {category}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        treemap_definition {
          title = "Value by biller (Rp)"
          request {
            formula {
              formula_expression = "query1"
            }
            query {
              metric_query {
                name        = "query1"
                data_source = "metrics"
                query       = "sum:nusabank.biller.payment.amount{${local.env},status:success} by {biller}.as_count()"
                aggregator  = "sum"
              }
            }
          }
        }
      }
      widget {
        query_table_definition {
          title = "By biller: transactions, value, success rate"
          request {
            q          = "sum:nusabank.biller.payment.count{${local.env}} by {biller}.as_count()"
            aggregator = "sum"
            alias      = "Transactions"
          }
          request {
            q          = "sum:nusabank.biller.payment.amount{${local.env},status:success} by {biller}.as_count()"
            aggregator = "sum"
            alias      = "Value (Rp)"
          }
          request {
            q          = "100 * sum:nusabank.biller.payment.count{${local.env},status:success} by {biller}.as_count() / sum:nusabank.biller.payment.count{${local.env}} by {biller}.as_count()"
            aggregator = "sum"
            alias      = "Success (%)"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Average ticket by category (Rp)"
          request {
            q = "top(avg:nusabank.biller.payment.amount{${local.env},status:success} by {category}, 8, 'mean', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Failed payments by biller"
          request {
            q = "top(sum:nusabank.biller.payment.count{${local.env},status:failed} by {biller}.as_count(), 10, 'sum', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "E-wallet top-ups by provider (per hour)"
          show_legend = true

          request {
            q            = "sum:nusabank.biller.payment.count{${local.env},category:ewallet} by {biller}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Transactions by biller (per hour)"
          show_legend = true

          request {
            q            = "sum:nusabank.biller.payment.count{${local.env},!category:ewallet} by {biller}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
    }
  }

  # @14
  widget {
    group_definition {
      title       = "Payments & top-ups — technology (biller-service, PPOB aggregator)"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Payments per second & error rate (%)"
          show_legend = true
          request {
            q            = "sum:trace.hono.request.hits{${local.bill_pay}}.as_rate()"
            display_type = "line"
            metadata {
              expression = "sum:trace.hono.request.hits{${local.bill_pay}}.as_rate()"
              alias_name = "Payments / s"
            }
          }
          request {
            q            = "100 * default_zero(sum:trace.hono.request.errors{${local.bill_pay}}.as_count()) / sum:trace.hono.request.hits{${local.bill_pay}}.as_count()"
            display_type = "line"
            metadata {
              expression = "100 * default_zero(sum:trace.hono.request.errors{${local.bill_pay}}.as_count()) / sum:trace.hono.request.hits{${local.bill_pay}}.as_count()"
              alias_name = "Error rate (%)"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Inquiry & payment latency"
          show_legend = true
          request {
            q            = "p95:trace.hono.request{${local.bill_inq}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.hono.request{${local.bill_inq}}"
              alias_name = "Inquiry — p95"
            }
          }
          request {
            q            = "avg:trace.hono.request{${local.bill_pay}}"
            display_type = "line"
            metadata {
              expression = "avg:trace.hono.request{${local.bill_pay}}"
              alias_name = "Payment — avg"
            }
          }
          request {
            q            = "p95:trace.hono.request{${local.bill_pay}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.hono.request{${local.bill_pay}}"
              alias_name = "Payment — p95"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "PPOB p95 latency by biller"
          show_legend = true

          request {
            q            = "p95:trace.ppob.request{${local.env}} by {peer.service}"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "PPOB aggregator error rate (%)"
          show_legend = false
          request {
            q            = "100 * default_zero(sum:trace.ppob.request.errors{service:nusabank-biller,${local.env}}.as_count()) / sum:trace.ppob.request.hits{service:nusabank-biller,${local.env}}.as_count()"
            display_type = "line"
          }
        }
      }
      widget {
        trace_service_definition {
          title              = "biller-service — service summary"
          env                = "demo"
          service            = "nusabank-biller"
          span_name          = "hono.request"
          show_hits          = true
          show_errors        = true
          show_latency       = true
          show_breakdown     = true
          show_distribution  = true
          show_resource_list = true
          size_format        = "medium"
          display_format     = "three_column"
        }
      }
      widget {
        timeseries_definition {
          title       = "PPOB error rate by biller (%)"
          show_legend = true

          request {
            q            = "100 * default_zero(sum:trace.ppob.request.errors{${local.env}} by {peer.service}.as_count()) / sum:trace.ppob.request.hits{${local.env}} by {peer.service}.as_count()"
            display_type = "line"
          }
        }
      }
      widget {
        query_value_definition {
          title     = "Payments left PENDING — biller timeouts"
          precision = 0
          request {
            formula {
              formula_expression = "default_zero(query1)"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "logs"
                indexes     = ["*"]
                compute {
                  aggregation = "count"
                }
                search {
                  query = "service:nusabank-biller \"biller timed out, payment pending\""
                }
              }
            }
          }
        }
      }
      widget {
        query_value_definition {
          title     = "Payments re-checked by the reconciler"
          precision = 0
          request {
            formula {
              formula_expression = "default_zero(query1)"
            }
            query {
              event_query {
                name        = "query1"
                data_source = "logs"
                indexes     = ["*"]
                compute {
                  aggregation = "count"
                }
                search {
                  query = "service:nusabank-biller \"biller still not answering\""
                }
              }
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Payment events: consumer lag on biller.payment.v1 (s)"
          show_legend = true
          custom_link {
            label = "Open Data Streams"
            link  = "/data-streams"
          }

          request {
            q            = "max:data_streams.kafka.lag_seconds{${local.env},topic:biller.payment.v1} by {consumer_group}"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Partner DB (MySQL): queries & connections"
          show_legend = true
          custom_link {
            label = "Open Database Monitoring"
            link  = "/databases"
          }

          request {
            q            = "avg:mysql.performance.queries{*}"
            display_type = "line"
            metadata {
              expression = "avg:mysql.performance.queries{*}"
              alias_name = "queries/s"
            }
          }
          request {
            q            = "avg:mysql.net.connections{*}"
            display_type = "line"
            metadata {
              expression = "avg:mysql.net.connections{*}"
              alias_name = "connections"
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Recent biller-service error traces"
          request {
            response_format = "event_list"
            query {
              data_source  = "trace_stream"
              query_string = "env:demo service:nusabank-biller status:error"
            }
            columns {
              field = "timestamp"
              width = "auto"
            }
            columns {
              field = "resource_name"
              width = "auto"
            }
            columns {
              field = "@duration"
              width = "auto"
            }
            columns {
              field = "@http.status_code"
              width = "auto"
            }
            columns {
              field = "@error.type"
              width = "auto"
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Failed PPOB calls"
          request {
            response_format = "event_list"
            query {
              data_source  = "trace_stream"
              query_string = "env:demo service:nusabank-biller operation_name:ppob.request status:error"
            }
            columns {
              field = "timestamp"
              width = "auto"
            }
            columns {
              field = "resource_name"
              width = "auto"
            }
            columns {
              field = "@peer.service"
              width = "auto"
            }
            columns {
              field = "@duration"
              width = "auto"
            }
            columns {
              field = "@error.type"
              width = "auto"
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "Error Tracking — biller-service"
          request {
            response_format = "event_list"
            query {
              data_source  = "apm_issue_stream"
              query_string = "env:demo service:nusabank-biller"
            }
            columns {
              field = "details"
              width = "auto"
            }
            columns {
              field = "count"
              width = "auto"
            }
            columns {
              field = "volume"
              width = "auto"
            }
          }
        }
      }
      widget {
        list_stream_definition {
          title = "biller-service warnings & errors"
          request {
            response_format = "event_list"
            query {
              data_source  = "logs_stream"
              query_string = "env:demo service:nusabank-biller status:(warn OR error)"
            }
            columns {
              field = "timestamp"
              width = "auto"
            }
            columns {
              field = "status"
              width = "auto"
            }
            columns {
              field = "message"
              width = "auto"
            }
          }
        }
      }
    }
  }

  # ═════════════════════════════ TAB 4 · LOANS ═════════════════════════════

  # @15
  widget {
    group_definition {
      title       = "Loans — business"
      layout_type = "ordered"

      widget {
        query_table_definition {
          title = "Applications by product and stage"
          request {
            q          = "sum:nusabank.loan.application.count{${local.env},stage:submitted} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Submitted"
          }
          request {
            q          = "sum:nusabank.loan.application.count{${local.env},stage:approved} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Approved"
          }
          request {
            q          = "sum:nusabank.loan.application.count{${local.env},stage:rejected} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Rejected"
          }
          request {
            q          = "sum:nusabank.loan.application.count{${local.env},stage:disbursed} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Disbursed"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Principal applied by product (Rp)"
          request {
            q = "top(sum:nusabank.loan.application.amount{${local.env},stage:submitted} by {product}.as_count(), 3, 'sum', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Principal disbursed by product (Rp)"
          request {
            q = "top(sum:nusabank.loan.application.amount{${local.env},stage:disbursed} by {product}.as_count(), 3, 'sum', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Loan simulations by product (per hour)"
          show_legend = true
          request {
            q            = "sum:nusabank.loan.simulation.count{${local.env}} by {product}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
    }
  }

  # @16
  widget {
    group_definition {
      title       = "Loans — technology (loan-service, credit bureau)"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Simulation & credit decision latency"
          show_legend = true
          request {
            q            = "p95:trace.servlet.request{${local.loan_sim}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.servlet.request{${local.loan_sim}}"
              alias_name = "Simulation — p95"
            }
          }
          request {
            q            = "p95:trace.servlet.request{${local.loan_submit}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.servlet.request{${local.loan_submit}}"
              alias_name = "Submit (decision) — p95"
            }
          }
          request {
            q            = "p95:trace.partner.request{peer.service:credit-bureau,${local.env}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.partner.request{peer.service:credit-bureau,${local.env}}"
              alias_name = "Credit bureau — p95"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "loan-service requests & errors"
          show_legend = true
          request {
            q            = "sum:trace.servlet.request.hits{service:nusabank-loan,${local.env}}.as_count()"
            display_type = "bars"
            metadata {
              expression = "sum:trace.servlet.request.hits{service:nusabank-loan,${local.env}}.as_count()"
              alias_name = "Requests"
            }
          }
          request {
            q            = "default_zero(sum:trace.servlet.request.errors{service:nusabank-loan,${local.env}}.as_count())"
            display_type = "bars"
            metadata {
              expression = "default_zero(sum:trace.servlet.request.errors{service:nusabank-loan,${local.env}}.as_count())"
              alias_name = "Errors"
            }
          }
        }
      }
    }
  }

  # ═════════════════════════════ TAB 5 · DIGITAL CHANNELS ═════════════════════════════

  # @17
  widget {
    group_definition {
      title       = "Digital channels — business"
      layout_type = "ordered"

      widget {
        query_table_definition {
          title = "Account opening funnel by product"
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:started} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Started"
          }
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:ekyc_submitted} by {product}.as_count()"
            aggregator = "sum"
            alias      = "e-KYC"
          }
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:submitted} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Submitted"
          }
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:approved} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Approved"
          }
          request {
            q          = "100 * sum:nusabank.onboarding.step.count{${local.env},step:approved} by {product}.as_count() / sum:nusabank.onboarding.step.count{${local.env},step:started} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Conversion (%)"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Logins per hour"
          show_legend = false
          request {
            q            = "sum:trace.hono.request.hits{${local.login}}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Loyalty points earned by source (per hour)"
          show_legend = true
          request {
            q            = "sum:nusabank.rewards.points.earned{${local.env}} by {source}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Support chat: messages and handoffs to an agent"
          show_legend = true
          request {
            q            = "sum:nusabank.chat.message.count{${local.env}} by {responder}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
          request {
            q            = "sum:nusabank.chat.handoff.count{${local.env}}.as_count().rollup(sum, 3600)"
            display_type = "line"
            metadata {
              expression = "sum:nusabank.chat.handoff.count{${local.env}}.as_count().rollup(sum, 3600)"
              alias_name = "Handed off to an agent"
            }
          }
        }
      }
    }
  }

  # @18
  widget {
    group_definition {
      title       = "Digital channels — technology (auth, rewards, chat)"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Login latency avg & p95"
          show_legend = true
          request {
            q            = "avg:trace.hono.request{${local.login}}"
            display_type = "line"
            metadata {
              expression = "avg:trace.hono.request{${local.login}}"
              alias_name = "Login — avg"
            }
          }
          request {
            q            = "p95:trace.hono.request{${local.login}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.hono.request{${local.login}}"
              alias_name = "Login — p95"
            }
          }
        }
      }
      widget {
        toplist_definition {
          title = "p95 latency by auth-service endpoint"
          request {
            q = "top(p95:trace.hono.request{service:nusabank-auth,${local.env}} by {resource_name}, 10, 'mean', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Digital channel error rate (%)"
          show_legend = true
          request {
            q            = "100 * default_zero(sum:trace.hono.request.errors{${local.env},service:nusabank-auth} by {service}.as_count()) / sum:trace.hono.request.hits{${local.env},service:nusabank-auth} by {service}.as_count()"
            display_type = "line"
          }
          request {
            q            = "100 * default_zero(sum:trace.hono.request.errors{${local.env},service:nusabank-rewards} by {service}.as_count()) / sum:trace.hono.request.hits{${local.env},service:nusabank-rewards} by {service}.as_count()"
            display_type = "line"
          }
          request {
            q            = "100 * default_zero(sum:trace.hono.request.errors{${local.env},service:nusabank-chat} by {service}.as_count()) / sum:trace.hono.request.hits{${local.env},service:nusabank-chat} by {service}.as_count()"
            display_type = "line"
          }
        }
      }
    }
  }

  # ═════════════════════════════ TAB 6 · SLOs ═════════════════════════════

  # @19
  widget {
    group_definition {
      title       = "Critical journey SLOs"
      layout_type = "ordered"

      widget {
        service_level_objective_definition {
          title             = "Nusa Bank Digital — critical journeys available"
          slo_id            = datadog_service_level_objective.digital_banking.id
          view_type         = "detail"
          view_mode         = "overall"
          time_windows      = ["7d", "30d"]
          show_error_budget = true
        }
      }
      dynamic "widget" {
        for_each = local.journeys
        content {
          service_level_objective_definition {
            title             = "${widget.value.title}: available"
            slo_id            = datadog_service_level_objective.journey_availability[widget.key].id
            view_type         = "detail"
            view_mode         = "overall"
            time_windows      = ["7d", "30d"]
            show_error_budget = true
          }
        }
      }
      dynamic "widget" {
        for_each = local.journeys
        content {
          service_level_objective_definition {
            title             = "${widget.value.title}: fast"
            slo_id            = datadog_service_level_objective.journey_latency[widget.key].id
            view_type         = "detail"
            view_mode         = "overall"
            time_windows      = ["7d", "30d"]
            show_error_budget = true
          }
        }
      }
    }
  }

  # @20
  widget {
    group_definition {
      title       = "Third-party SLOs — is it us or the partner?"
      layout_type = "ordered"

      widget {
        service_level_objective_definition {
          title             = "PPOB billers (per biller)"
          slo_id            = datadog_service_level_objective.partner_ppob.id
          view_type         = "detail"
          view_mode         = "both"
          time_windows      = ["7d", "30d"]
          show_error_budget = true
        }
      }
      widget {
        service_level_objective_definition {
          title             = "Transfer rails: BI FAST & SKN"
          slo_id            = datadog_service_level_objective.partner_rails.id
          view_type         = "detail"
          view_mode         = "both"
          time_windows      = ["7d", "30d"]
          show_error_budget = true
        }
      }
    }
  }

  # Tabs reference the top-level widgets (the groups above) by position.
  tab {
    name       = "Overview"
    widget_ids = ["@1", "@2", "@3", "@4", "@5", "@6", "@7", "@8", "@9", "@10"]
  }
  tab {
    name       = "Transfers"
    widget_ids = ["@11", "@12"]
  }
  tab {
    name       = "Payments & Top-ups"
    widget_ids = ["@13", "@14"]
  }
  tab {
    name       = "Loans"
    widget_ids = ["@15", "@16"]
  }
  tab {
    name       = "Digital Channels"
    widget_ids = ["@17", "@18"]
  }
  tab {
    name       = "SLOs"
    widget_ids = ["@19", "@20"]
  }
}

output "business_dashboard_url" {
  value = "https://app.datadoghq.com${datadog_dashboard.business.url}"
}
