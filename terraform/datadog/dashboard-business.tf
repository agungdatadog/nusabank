# EP1 "complete picture": one dashboard, one tab per business line. Each tab pairs the
# business view (DogStatsD nusabank.* metrics, amounts as values in IDR) with the technical
# view of the services behind it (APM trace metrics), so a dip in one explains the other.
# Server-span operation names differ per runtime: Go http.request, Node hono.request,
# Java servlet.request. payment-service's http.request also covers its outbound calls,
# so its widgets filter on server resources.

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
}

resource "datadog_dashboard" "business" {
  title       = "Nusa Bank — Bisnis & Teknologi"
  description = "EP1: nilai bisnis (transfer, top up & tagihan, kredit, kanal digital) berdampingan dengan performa layanan yang menjalankannya. Managed by Terraform (terraform/datadog)."
  layout_type = "ordered"
  reflow_type = "auto"
  tags        = ["team:nusabank"]

  # ───────────────────────────── 1. Ringkasan ─────────────────────────────
  widget {
    group_definition {
      title       = "Bisnis hari ini"
      layout_type = "ordered"

      widget {
        query_value_definition {
          title       = "Nilai transfer keluar"
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
          title     = "Transaksi transfer"
          precision = 0
          request {
            q          = "sum:nusabank.transfer.count{${local.env}}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        query_value_definition {
          title       = "Transfer berhasil"
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
        query_value_definition {
          title       = "Nilai top up & tagihan"
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
          title       = "Top up & tagihan berhasil"
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
        query_value_definition {
          title       = "Kredit diajukan"
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
          title     = "Rekening baru disetujui"
          precision = 0
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:approved}.as_count()"
            aggregator = "sum"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Transaksi per menit — transfer vs top up & tagihan"
          show_legend = true
          request {
            q            = "sum:nusabank.transfer.count{${local.env}}.as_count().rollup(sum, 60)"
            display_type = "bars"
            metadata {
              expression = "sum:nusabank.transfer.count{${local.env}}.as_count().rollup(sum, 60)"
              alias_name = "Transfer"
            }
          }
          request {
            q            = "sum:nusabank.biller.payment.count{${local.env}}.as_count().rollup(sum, 60)"
            display_type = "bars"
            metadata {
              expression = "sum:nusabank.biller.payment.count{${local.env}}.as_count().rollup(sum, 60)"
              alias_name = "Top up & tagihan"
            }
          }
        }
      }
    }
  }

  widget {
    group_definition {
      title       = "Kesehatan layanan"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Latensi p95 alur utama (detik)"
          show_legend = true
          request {
            q            = "p95:trace.http.request{${local.pay_create}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.http.request{${local.pay_create}}"
              alias_name = "Kirim transfer"
            }
          }
          request {
            q            = "p95:trace.hono.request{${local.bill_pay}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.hono.request{${local.bill_pay}}"
              alias_name = "Bayar tagihan"
            }
          }
          request {
            q            = "p95:trace.hono.request{${local.login}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.hono.request{${local.login}}"
              alias_name = "Login"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Error rate API per layanan (%)"
          show_legend = true
          request {
            q            = "100 * default_zero(sum:trace.servlet.request.errors{${local.env}} by {service}.as_count()) / sum:trace.servlet.request.hits{${local.env}} by {service}.as_count()"
            display_type = "line"
          }
          request {
            q            = "100 * default_zero(sum:trace.hono.request.errors{${local.env}} by {service}.as_count()) / sum:trace.hono.request.hits{${local.env}} by {service}.as_count()"
            display_type = "line"
          }
          request {
            q            = "100 * default_zero(sum:trace.http.request.errors{service:nusabank-payment,${local.env}}.as_count()) / sum:trace.http.request.hits{service:nusabank-payment,${local.env}}.as_count()"
            display_type = "line"
            metadata {
              expression = "100 * default_zero(sum:trace.http.request.errors{service:nusabank-payment,${local.env}}.as_count()) / sum:trace.http.request.hits{service:nusabank-payment,${local.env}}.as_count()"
              alias_name = "service:nusabank-payment"
            }
          }
        }
      }
      widget {
        query_table_definition {
          title = "Request per jam per layanan (rata-rata)"
          request {
            q          = "avg:trace.servlet.request.hits{${local.env}} by {service}.as_rate() * 3600"
            aggregator = "avg"
            alias      = "Java (servlet)"
          }
          request {
            q          = "avg:trace.hono.request.hits{${local.env}} by {service}.as_rate() * 3600"
            aggregator = "avg"
            alias      = "Node (hono)"
          }
        }
      }
    }
  }

  widget {
    group_definition {
      title       = "Partner pihak ketiga (peer.service)"
      layout_type = "ordered"

      widget {
        toplist_definition {
          title = "Latensi p95 per biller lewat agregator PPOB (detik)"
          request {
            q = "top(p95:trace.ppob.request{${local.env}} by {peer.service}, 20, 'mean', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Latensi p95 rail & biro kredit (detik)"
          request {
            q = "top(p95:trace.partner.request{${local.env}} by {peer.service}, 10, 'mean', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Error rate per partner (%)"
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
    }
  }

  # ───────────────────────────── 2. Transfer ─────────────────────────────
  widget {
    group_definition {
      title       = "Transfer — bisnis"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Jumlah transfer per channel (per jam)"
          show_legend = true
          request {
            q            = "sum:nusabank.transfer.count{${local.env}} by {rail}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Nilai transfer per channel (Rp per jam)"
          show_legend = true
          request {
            q            = "sum:nusabank.transfer.amount{${local.env},status:success} by {rail}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Bank tujuan — jumlah transfer (BI FAST & SKN)"
          request {
            q = "top(sum:nusabank.transfer.count{${local.env},!rail:intrabank} by {destination_bank}.as_count(), 12, 'sum', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Bank tujuan — nilai transfer (Rp)"
          request {
            q = "top(sum:nusabank.transfer.amount{${local.env},status:success,!rail:intrabank} by {destination_bank}.as_count(), 12, 'sum', 'desc')"
          }
        }
      }
      widget {
        query_table_definition {
          title = "Per channel: transaksi, nilai, tingkat berhasil"
          request {
            q          = "sum:nusabank.transfer.count{${local.env}} by {rail}.as_count()"
            aggregator = "sum"
            alias      = "Transaksi"
          }
          request {
            q          = "sum:nusabank.transfer.amount{${local.env},status:success} by {rail}.as_count()"
            aggregator = "sum"
            alias      = "Nilai (Rp)"
          }
          request {
            q          = "100 * sum:nusabank.transfer.count{${local.env},status:success} by {rail}.as_count() / sum:nusabank.transfer.count{${local.env}} by {rail}.as_count()"
            aggregator = "sum"
            alias      = "Berhasil (%)"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Dana keluar vs dana masuk (Rp per jam)"
          show_legend = true
          request {
            q            = "sum:nusabank.transfer.amount{${local.env},status:success}.as_count().rollup(sum, 3600)"
            display_type = "bars"
            metadata {
              expression = "sum:nusabank.transfer.amount{${local.env},status:success}.as_count().rollup(sum, 3600)"
              alias_name = "Keluar"
            }
          }
          request {
            q            = "sum:nusabank.transfer.inbound.amount{${local.env}}.as_count().rollup(sum, 3600)"
            display_type = "bars"
            metadata {
              expression = "sum:nusabank.transfer.inbound.amount{${local.env}}.as_count().rollup(sum, 3600)"
              alias_name = "Masuk"
            }
          }
        }
      }
    }
  }

  widget {
    group_definition {
      title       = "Transfer — teknologi (payment-service, BI FAST, SKN)"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Transfer dikirim per detik (TPS)"
          show_legend = false
          request {
            q            = "sum:trace.http.request.hits{${local.pay_create}}.as_rate()"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Latensi kirim transfer & inquiry (detik)"
          show_legend = true
          request {
            q            = "avg:trace.http.request{${local.pay_create}}"
            display_type = "line"
            metadata {
              expression = "avg:trace.http.request{${local.pay_create}}"
              alias_name = "Kirim transfer — avg"
            }
          }
          request {
            q            = "p95:trace.http.request{${local.pay_create}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.http.request{${local.pay_create}}"
              alias_name = "Kirim transfer — p95"
            }
          }
          request {
            q            = "p95:trace.http.request{${local.pay_inquiry}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.http.request{${local.pay_inquiry}}"
              alias_name = "Inquiry rekening tujuan — p95"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Error rate kirim transfer (%)"
          show_legend = false
          request {
            q            = "100 * default_zero(sum:trace.http.request.errors{${local.pay_create}}.as_count()) / sum:trace.http.request.hits{${local.pay_create}}.as_count()"
            display_type = "line"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Latensi p95 partner: BI FAST & SKN (detik)"
          show_legend = true
          request {
            q            = "p95:trace.http.request{service:nusabank-partner-mock,${local.env}} by {resource_name}"
            display_type = "line"
          }
        }
      }
    }
  }

  # ───────────────────────────── 3. Top Up & Tagihan ─────────────────────────────
  widget {
    group_definition {
      title       = "Top up & tagihan — bisnis"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Transaksi per kategori (per jam)"
          show_legend = true
          request {
            q            = "sum:nusabank.biller.payment.count{${local.env}} by {category}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Nilai per biller (Rp)"
          request {
            q = "top(sum:nusabank.biller.payment.amount{${local.env},status:success} by {biller}.as_count(), 16, 'sum', 'desc')"
          }
        }
      }
      widget {
        query_table_definition {
          title = "Per biller: transaksi, nilai, tingkat berhasil"
          request {
            q          = "sum:nusabank.biller.payment.count{${local.env}} by {biller}.as_count()"
            aggregator = "sum"
            alias      = "Transaksi"
          }
          request {
            q          = "sum:nusabank.biller.payment.amount{${local.env},status:success} by {biller}.as_count()"
            aggregator = "sum"
            alias      = "Nilai (Rp)"
          }
          request {
            q          = "100 * sum:nusabank.biller.payment.count{${local.env},status:success} by {biller}.as_count() / sum:nusabank.biller.payment.count{${local.env}} by {biller}.as_count()"
            aggregator = "sum"
            alias      = "Berhasil (%)"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Rata-rata nilai per transaksi per kategori (Rp)"
          request {
            q = "top(avg:nusabank.biller.payment.amount{${local.env},status:success} by {category}, 8, 'mean', 'desc')"
          }
        }
      }
    }
  }

  widget {
    group_definition {
      title       = "Top up & tagihan — teknologi (biller-service, agregator PPOB)"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Pembayaran per detik & error rate (%)"
          show_legend = true
          request {
            q            = "sum:trace.hono.request.hits{${local.bill_pay}}.as_rate()"
            display_type = "line"
            metadata {
              expression = "sum:trace.hono.request.hits{${local.bill_pay}}.as_rate()"
              alias_name = "Pembayaran / detik"
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
          title       = "Latensi inquiry & bayar (detik)"
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
              alias_name = "Bayar — avg"
            }
          }
          request {
            q            = "p95:trace.hono.request{${local.bill_pay}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.hono.request{${local.bill_pay}}"
              alias_name = "Bayar — p95"
            }
          }
        }
      }
      widget {
        toplist_definition {
          title = "Latensi p95 per biller di agregator PPOB (detik)"
          request {
            q = "top(p95:trace.ppob.request{service:nusabank-biller,${local.env}} by {resource_name}, 16, 'mean', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Error rate panggilan ke agregator PPOB (%)"
          show_legend = false
          request {
            q            = "100 * default_zero(sum:trace.ppob.request.errors{service:nusabank-biller,${local.env}}.as_count()) / sum:trace.ppob.request.hits{service:nusabank-biller,${local.env}}.as_count()"
            display_type = "line"
          }
        }
      }
    }
  }

  # ───────────────────────────── 4. Kredit ─────────────────────────────
  widget {
    group_definition {
      title       = "Kredit — bisnis"
      layout_type = "ordered"

      widget {
        query_table_definition {
          title = "Pengajuan per produk dan tahap"
          request {
            q          = "sum:nusabank.loan.application.count{${local.env},stage:submitted} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Diajukan"
          }
          request {
            q          = "sum:nusabank.loan.application.count{${local.env},stage:approved} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Disetujui"
          }
          request {
            q          = "sum:nusabank.loan.application.count{${local.env},stage:rejected} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Ditolak"
          }
          request {
            q          = "sum:nusabank.loan.application.count{${local.env},stage:disbursed} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Dicairkan"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Nilai pokok diajukan per produk (Rp)"
          request {
            q = "top(sum:nusabank.loan.application.amount{${local.env},stage:submitted} by {product}.as_count(), 3, 'sum', 'desc')"
          }
        }
      }
      widget {
        toplist_definition {
          title = "Nilai pokok dicairkan per produk (Rp)"
          request {
            q = "top(sum:nusabank.loan.application.amount{${local.env},stage:disbursed} by {product}.as_count(), 3, 'sum', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Simulasi kredit per produk (per jam)"
          show_legend = true
          request {
            q            = "sum:nusabank.loan.simulation.count{${local.env}} by {product}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
    }
  }

  widget {
    group_definition {
      title       = "Kredit — teknologi (loan-service, biro kredit)"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Latensi simulasi & keputusan kredit (detik)"
          show_legend = true
          request {
            q            = "p95:trace.servlet.request{${local.loan_sim}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.servlet.request{${local.loan_sim}}"
              alias_name = "Simulasi — p95"
            }
          }
          request {
            q            = "p95:trace.servlet.request{${local.loan_submit}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.servlet.request{${local.loan_submit}}"
              alias_name = "Submit (keputusan) — p95"
            }
          }
          request {
            q            = "p95:trace.http.request{service:nusabank-loan,resource_name:post_/credit-bureau/v1/checks,${local.env}}"
            display_type = "line"
            metadata {
              expression = "p95:trace.http.request{service:nusabank-loan,resource_name:post_/credit-bureau/v1/checks,${local.env}}"
              alias_name = "Biro kredit — p95"
            }
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Request & error loan-service"
          show_legend = true
          request {
            q            = "sum:trace.servlet.request.hits{service:nusabank-loan,${local.env}}.as_count()"
            display_type = "bars"
            metadata {
              expression = "sum:trace.servlet.request.hits{service:nusabank-loan,${local.env}}.as_count()"
              alias_name = "Request"
            }
          }
          request {
            q            = "default_zero(sum:trace.servlet.request.errors{service:nusabank-loan,${local.env}}.as_count())"
            display_type = "bars"
            metadata {
              expression = "default_zero(sum:trace.servlet.request.errors{service:nusabank-loan,${local.env}}.as_count())"
              alias_name = "Error"
            }
          }
        }
      }
    }
  }

  # ───────────────────────────── 5. Kanal Digital ─────────────────────────────
  widget {
    group_definition {
      title       = "Kanal digital — bisnis"
      layout_type = "ordered"

      widget {
        query_table_definition {
          title = "Funnel buka rekening per produk"
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:started} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Mulai"
          }
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:ekyc_submitted} by {product}.as_count()"
            aggregator = "sum"
            alias      = "e-KYC"
          }
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:submitted} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Submit"
          }
          request {
            q          = "sum:nusabank.onboarding.step.count{${local.env},step:approved} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Disetujui"
          }
          request {
            q          = "100 * sum:nusabank.onboarding.step.count{${local.env},step:approved} by {product}.as_count() / sum:nusabank.onboarding.step.count{${local.env},step:started} by {product}.as_count()"
            aggregator = "sum"
            alias      = "Konversi (%)"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Login per jam"
          show_legend = false
          request {
            q            = "sum:trace.hono.request.hits{${local.login}}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Nusa Poin diperoleh per sumber (per jam)"
          show_legend = true
          request {
            q            = "sum:nusabank.rewards.points.earned{${local.env}} by {source}.as_count().rollup(sum, 3600)"
            display_type = "bars"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Chat bantuan: pesan & dialihkan ke petugas"
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
              alias_name = "Dialihkan ke petugas"
            }
          }
        }
      }
    }
  }

  widget {
    group_definition {
      title       = "Kanal digital — teknologi (auth, rewards, chat)"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title       = "Latensi login avg & p95 (detik)"
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
          title = "Latensi p95 per endpoint auth-service (detik)"
          request {
            q = "top(p95:trace.hono.request{service:nusabank-auth,${local.env}} by {resource_name}, 10, 'mean', 'desc')"
          }
        }
      }
      widget {
        timeseries_definition {
          title       = "Error rate kanal digital (%)"
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

  # Tabs reference the top-level widgets (the groups above) by position.
  tab {
    name       = "Ringkasan"
    widget_ids = ["@1", "@2", "@3"]
  }
  tab {
    name       = "Transfer"
    widget_ids = ["@4", "@5"]
  }
  tab {
    name       = "Top Up & Tagihan"
    widget_ids = ["@6", "@7"]
  }
  tab {
    name       = "Kredit"
    widget_ids = ["@8", "@9"]
  }
  tab {
    name       = "Kanal Digital"
    widget_ids = ["@10", "@11"]
  }
}

output "business_dashboard_url" {
  value = "https://app.datadoghq.com${datadog_dashboard.business.url}"
}
