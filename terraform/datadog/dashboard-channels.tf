# EP2 Part 1: the Digital Channels team's own view of Top Up & Tagihan. During a GoPay partner
# outage they contain it from here: switch GoPay off, watch the partner's error rate (biller-service
# keeps checking GoPay while it is off), and switch it back on once the data says it has recovered.

resource "datadog_dashboard" "channels" {
  title       = "[Nusa Bank] Digital Channels — Top Up & Tagihan"
  description = "Owned by Nusa Bank Digital Channels (nusabank-biller). Partner health per biller, money impact, and the GoPay switch used during a partner outage. Managed by Terraform (terraform/datadog)."
  layout_type = "ordered"
  reflow_type = "auto"
  tags        = ["team:nusabank-channels"]

  widget {
    group_definition {
      title            = "GoPay switch"
      layout_type      = "ordered"
      background_color = "vivid_orange"

      widget {
        note_definition {
          content          = <<-EOT
            **During a GoPay partner outage**

            1. **Contain** — the incident confirms only GoPay fails and no money moves.
            2. **Nonaktifkan GoPay** — customers see GoPay greyed out and pick another e-wallet instead of failing.
            3. **Escalate** to the partner with the incident's evidence.
            4. **Verify with data** — wait for *GoPay error rate* below to reach 0%. biller-service keeps checking GoPay while it is off.
            5. **Aktifkan kembali GoPay**.

            Each switch is audited in Back Office (BILLER_DISABLE / BILLER_ENABLE) and shows under *Changes*. A forgotten switch turns itself back on after 2 hours.
          EOT
          background_color = "white"
          font_size        = "14"
          text_align       = "left"
          show_tick        = false
        }
      }
      widget {
        query_value_definition {
          title     = "GoPay in the app (1 = on, 0 = off)"
          precision = 0
          request {
            q          = "min:nusabank.biller.available{env:demo,biller:gopay}"
            aggregator = "last"
            conditional_formats {
              comparator = ">="
              value      = 1
              palette    = "white_on_green"
            }
            conditional_formats {
              comparator = "<"
              value      = 1
              palette    = "white_on_red"
            }
          }
        }
      }
      widget {
        run_workflow_definition {
          title       = "1 · Nonaktifkan GoPay"
          workflow_id = datadog_workflow_automation.gopay_switch["disable"].id
        }
      }
      widget {
        run_workflow_definition {
          title       = "2 · Aktifkan kembali GoPay"
          workflow_id = datadog_workflow_automation.gopay_switch["enable"].id
        }
      }
    }
  }

  widget {
    group_definition {
      title       = "Partner health"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "GoPay error rate (%)"
          show_legend = false
          request {
            q            = "100 * default_zero(sum:trace.ppob.request.errors{env:demo,peer.service:ppob-gopay}.as_count()) / sum:trace.ppob.request.hits{env:demo,peer.service:ppob-gopay}.as_count()"
            display_type = "bars"
            style {
              palette = "warm"
            }
          }
          marker {
            value        = "y = 10"
            display_type = "error dashed"
            label        = "monitor alerts"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Error rate by biller (%)"
          show_legend = true
          request {
            q            = "100 * default_zero(sum:trace.ppob.request.errors{env:demo} by {peer.service}.as_count()) / sum:trace.ppob.request.hits{env:demo} by {peer.service}.as_count()"
            display_type = "line"
          }
        }
      }
      widget {
        manage_status_definition {
          title               = "Biller monitors"
          query               = "\"Biller\" \"is failing\""
          summary_type        = "groups"
          display_format      = "list"
          color_preference    = "background"
          hide_zero_counts    = true
          show_last_triggered = true
          sort                = "status,asc"
        }
      }
    }
  }

  widget {
    group_definition {
      title       = "Money impact"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "GoPay top-ups by result"
          show_legend = true
          request {
            q            = "sum:nusabank.biller.payment.count{env:demo,biller:gopay} by {status}.as_count()"
            display_type = "bars"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Payments by biller"
          request {
            q = "top(sum:nusabank.biller.payment.count{env:demo} by {biller}.as_count(), 16, 'sum', 'desc')"
          }
        }
      }
    }
  }

  widget {
    group_definition {
      title       = "Changes"
      layout_type = "ordered"

      widget {
        list_stream_definition {
          title = "Biller switches (who, when)"
          request {
            response_format = "event_list"
            query {
              data_source  = "event_stream"
              query_string = "service:nusabank-biller category:change"
              event_size   = "l"
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
}
