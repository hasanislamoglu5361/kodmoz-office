# hermes-office (Hermes plugin)

Hermes Agent oturumlarını **Kodmoz Ofis** görselleştirmesine bağlayan observer köprüsü.

Docker kurulumunda `scripts/docker-setup.mjs` bu plugin'i her profile otomatik kopyalar ve etkinleştirir. Manuel kurulum için aşağıdaki adımları kullanabilirsin.

## Kurulum (tek profil)

```bash
mkdir -p ~/.hermes/plugins
cp -R hermes-plugin/hermes-office ~/.hermes/plugins/
hermes plugins enable hermes-office
```

`~/.hermes/.env` dosyasına ekle:

```bash
OFFICE_URL=http://127.0.0.1:4173
HERMES_OFFICE_AGENT_ID=atlas
HERMES_OFFICE_AGENT_NAME=Atlas
HERMES_OFFICE_ROLE=Orkestratör
# HERMES_OFFICE_SEND_TITLES=0
```

Hermes'i yeniden başlat.

## Docker / çoklu profil

Kodmoz Ofis Docker düzeninde her profil kendi `plugins/hermes-office` kopyasına ve şu ortam değişkenlerine sahiptir:

```bash
OFFICE_URL=http://host.docker.internal:4173
HERMES_OFFICE_AGENT_ID=deniz
HERMES_OFFICE_AGENT_NAME=Deniz
HERMES_OFFICE_ROLE=Ürün
```

`HERMES_OFFICE_AGENT_ID`, ofisteki agent kaydıyla eşleşir. Alt ajanlar geçici olarak ofise otomatik eklenir.

## Kaydedilen hook'lar

`on_session_start`, `on_session_end`, `on_session_finalize`, `pre_llm_call`, `post_llm_call`, `pre_tool_call`, `post_tool_call`, `subagent_start`, `subagent_stop`.

## Davranış

- Tüm gönderimler arka plan thread'inde, 1.5 sn timeout ile yapılır; **Hermes akışını bloklamaz**.
- Ofis kapalıysa olay sessizce düşer.
- Araç argümanları, dosya içerikleri ve tam konuşmalar gönderilmez. Yalnızca agent/oturum kimliği, model/platform, araç adı ve 90 karaktere kısaltılmış görev başlığı gönderilir.
- `subagent_start` olayı ofiste gerçek bir devir animasyonu başlatır: parent agent hedefin masasına yürür, işi teslim eder ve döner.

## Hızlı test

Ofis çalışırken:

```bash
curl -X POST http://127.0.0.1:4173/api/hermes/event \
  -H 'content-type: application/json' \
  -d '{"type":"session_start","sessionId":"test-1","agentId":"atlas","agentName":"Atlas","role":"Orkestratör","model":"test","platform":"cli"}'

curl -X POST http://127.0.0.1:4173/api/hermes/event \
  -H 'content-type: application/json' \
  -d '{"type":"llm_start","sessionId":"test-1","agentId":"atlas","taskTitle":"Köprü testi"}'
```

Ofiste `Atlas` agentı çalışıyor durumuna geçmeli ve görev görünmelidir.

## Not

Bu plugin Hermes'in **observer** hook'larını kullanır; Hermes'in planlayıcısını, araçlarını veya yürütmesini değiştirmez. Ofisten görev gönderimi Hermes'in OpenAI uyumlu API server'ı (`/v1/runs`) üzerinden yapılır; plugin yalnızca olayları izler.
