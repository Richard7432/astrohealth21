"""Mission operations, validation and simulated delivery for AstroHealth."""
import json
import math
import sqlite3
from datetime import datetime, timedelta
from uuid import uuid4

from storage import connect, digest, encode, initialize, now
from telemetry import CREW, DEVICES, GUIDE, METRICS, PHASES, fixture_values, packet, stamp

ROUTES = {"reading": "Controle de missão", "checkin": "Apoio de bordo", "review": "Controle de missão"}
QUALITIES = {
    "usable": "Amostra sintética disponível", "disconnected": "Sensor sem conexão",
    "low_battery": "Bateria baixa no dispositivo", "stale": "Atraso simulado do sensor",
    "out_of_order": "Amostra recebida fora de ordem",
}
FIELDS = (
    "event_id", "astronaut_id", "session_id", "device_id", "device_type", "metric_code",
    "value", "unit", "origin", "captured_at", "phase", "quality", "schema_version", "sequence",
)


class Mission:
    def __init__(self, directory):
        directory.mkdir(parents=True, exist_ok=True)
        self.local = directory / "mission-v04.sqlite"
        self.remote = directory / "receiver-v04.sqlite"
        initialize(self.local, self.remote)
        with connect(self.local, write=True) as db:
            for crew in CREW:
                if not db.execute("SELECT 1 FROM sessions WHERE astronaut_id=?", (crew,)).fetchone():
                    session = self.create(db, crew, "Esteira orbital", seeded=True)
                    for i in range(18):
                        phase = PHASES[0 if i < 3 else 1 if i < 13 else 2]
                        self.sample(db, session, i, phase, offset=(i - 17) * 60,
                                    gap=("shirt",) if i in (10, 11) else ())
                    self.audit(db, session, "Sessão de demonstração carregada")

    def create(self, db, crew, activity, *, seeded=False, guided=False):
        session_id = ("SIM" if seeded else "EX") + "-" + crew + "-" + uuid4().hex[:12].upper()
        db.execute("UPDATE sessions SET selected=0 WHERE astronaut_id=?", (crew,))
        db.execute("INSERT INTO sessions(id,astronaut_id,activity,phase,started,step) VALUES(?,?,?,?,?,?)",
                   (session_id, crew, activity, PHASES[2 if seeded else 0],
                    stamp(-1020 if seeded else -45 if guided else 0), 0 if guided else None))
        for kind, info in DEVICES.items():
            db.execute("INSERT INTO devices (id,session_id,type,battery) VALUES(?,?,?,?)",
                       (session_id + "-" + info["code"], session_id, kind, info["battery"]))
        return self.session(db, crew, session_id)

    def session(self, db, crew, session_id=None):
        if crew not in CREW:
            raise ValueError("Perfil fictício inválido.")
        clause = "id=?" if session_id else "selected=1"
        args = (crew, session_id) if session_id else (crew,)
        row = db.execute("SELECT * FROM sessions WHERE astronaut_id=? AND " + clause, args).fetchone()
        if row is None:
            raise ValueError("Sessão indisponível para este perfil.")
        return dict(row)

    def devices(self, db, session):
        return [dict(d) for d in db.execute("SELECT * FROM devices WHERE session_id=? ORDER BY rowid", (session["id"],))]

    def audit(self, db, session, action, event_id=None, detail=""):
        db.execute("INSERT INTO audit (session_id,at,action,event_id,detail) VALUES(?,?,?,?,?)",
                   (session["id"], now(), action, event_id, detail))

    def persist(self, db, session, kind, payload, authorized=True):
        event_id = payload["event_id"]
        checksum = digest(payload)
        existing = db.execute("SELECT hash FROM events WHERE id=?", (event_id,)).fetchone()
        if existing:
            same = existing["hash"] == checksum
            self.audit(db, session, "Duplicata ignorada" if same else "Conflito", event_id,
                       "O registro original foi preservado.")
            return ("Duplicata ignorada", 200) if same else ("Conflito de identificador.", 409)
        fail = db.execute("SELECT storage_fault FROM sessions WHERE id=?", (session["id"],)).fetchone()[0]
        if fail:
            self.audit(db, session, "Escrita simulada bloqueada", event_id,
                       "Falha injetada antes da gravação do registro e da fila.")
            return "Falha simulada de armazenamento. Registro não salvo.", 503
        record = {**payload, "received_at": now(), "authorized": authorized, "kind": kind}
        db.execute("INSERT INTO events VALUES(?,?,?,?,?)",
                   (event_id, session["id"], kind, checksum, encode(record)))
        if authorized:
            db.execute("INSERT INTO outbox (id,receiver,created) VALUES(?,?,?)",
                       (event_id, ROUTES[kind], record["received_at"]))
        return "Registro salvo localmente.", 200

    def ingest(self, db, session, raw):
        eid = raw.get("event_id")
        try:
            if not isinstance(eid, str) or not 1 <= len(eid) <= 100:
                raise ValueError("Identificador inválido.")
            payload = {key: raw[key] for key in FIELDS}
            if payload["astronaut_id"] != session["astronaut_id"] or payload["session_id"] != session["id"]:
                raise ValueError("Vínculo de astronauta ou sessão inválido.")
            device = db.execute("SELECT * FROM devices WHERE id=? AND session_id=?",
                                (payload["device_id"], session["id"])).fetchone()
            if device is None or device["connection"] == "revoked" or device["type"] != payload["device_type"]:
                raise ValueError("Dispositivo incompatível, desconhecido ou revogado.")
            if (payload["phase"] not in PHASES[:3] or payload["origin"] != "synthetic"
                    or type(payload["schema_version"]) is not int or payload["schema_version"] != 1):
                raise ValueError("Use uma fase ativa e o esquema sintético v1.")
            metric = payload["metric_code"]
            if metric not in METRICS or METRICS[metric][4] != device["type"]:
                raise ValueError("Métrica incompatível com o dispositivo.")
            _, unit, minimum, maximum, _, estimated = METRICS[metric]
            if payload["unit"] != unit:
                raise ValueError("Unidade incompatível com a métrica.")
            try:
                captured = datetime.fromisoformat(payload["captured_at"])
                if captured.utcoffset() is None or (captured - datetime.fromisoformat(now())).total_seconds() > 120:
                    raise ValueError()
            except (TypeError, ValueError):
                raise ValueError("Horário inválido, futuro ou sem fuso.") from None
            value, quality, sequence = payload["value"], payload["quality"], payload["sequence"]
            if quality not in QUALITIES or type(sequence) is not int or sequence < 0:
                raise ValueError("Qualidade ou sequência inválida.")
            if (quality == "disconnected") != (value is None):
                raise ValueError("Amostra sem sinal precisa conter valor nulo.")
            if value is not None and (type(value) not in (int, float) or not minimum <= value <= maximum or not math.isfinite(value)):
                raise ValueError("Valor fora da faixa instrumental sintética.")
        except (TypeError, KeyError, ValueError) as exc:
            message = str(exc) if isinstance(exc, ValueError) else "Leitura incompleta ou incompatível."
            self.audit(db, session, "Leitura rejeitada", eid if isinstance(eid, str) else None, message)
            return message, 422
        # Event content is stable across retries. Arrival annotations do not change its hash.
        payload.update(estimated=estimated, calibration="não aplicável · simulação",
                       quality_reason=QUALITIES[quality],
                       method="Curva determinística do cenário v1" if estimated else "Gerador sintético v1")
        message, status = self.persist(db, session, "reading", payload)
        return message, status

    def sample(self, db, session, i, phase, *, offset=0, gap=(), captured=None):
        devices = {d["type"]: d for d in self.devices(db, session) if d["connection"] != "revoked"}
        for metric, value in fixture_values(i, session["astronaut_id"]).items():
            device = devices[METRICS[metric][4]]
            missing = device["type"] in gap or device["connection"] == "offline"
            quality = "disconnected" if missing else "low_battery" if device["battery"] < 20 else "usable"
            result = self.ingest(db, session, packet(session, device, metric, None if missing else value,
                                 captured or stamp(offset), phase=phase, quality=quality, sequence=i))
            if result[1] != 200:
                return result
        return "Amostras sintéticas registradas.", 200

    def note(self, db, session, kind, note, label, authorized):
        if not isinstance(note, str) or len(note.strip()) > 240:
            raise ValueError("Use uma observação sintética de até 240 caracteres.")
        allowed = ("Dentro do esperado", "Quero revisar a sessão") if kind == "checkin" else ("Revisão técnica",)
        if label not in allowed or type(authorized) is not bool:
            raise ValueError("Tipo de registro ou autorização inválidos.")
        payload = dict(event_id=uuid4().hex, astronaut_id=session["astronaut_id"], session_id=session["id"],
                       phase=session["phase"], origin="synthetic", schema_version=1, label=label,
                       text=note.strip(), captured_at=now())
        result = self.persist(db, session, kind, payload, authorized)
        if result[1] == 200:
            self.audit(db, session, label, payload["event_id"],
                       "Incluído na fila autorizada." if authorized else "Somente local.")
        return result

    def set_field(self, db, session, field, value):
        allowed = {"link", "storage_fault", "phase", "step", "ended"}
        if field not in allowed:
            raise ValueError("Campo de sessão inválido.")
        db.execute(f"UPDATE sessions SET {field}=? WHERE id=?", (value, session["id"]))

    def view(self, crew, sid=None):
        with connect(self.local) as db:
            session = self.session(db, crew, sid)
            records = [dict(row) for row in db.execute("""
                SELECT e.data,o.state,o.receiver,o.created,o.attempts,o.ack_at,o.last_error
                FROM events e LEFT JOIN outbox o USING (id) WHERE e.session_id=? ORDER BY e.rowid
            """, (session["id"],))]
            for record in records:
                record.update(json.loads(record.pop("data")))
            history = [dict(r) for r in db.execute("""
                SELECT id,activity,started,phase,ended,selected,step FROM sessions
                WHERE astronaut_id=? ORDER BY rowid DESC
            """, (crew,))]
            audit = [dict(r) for r in db.execute(
                "SELECT * FROM audit WHERE session_id=? ORDER BY seq DESC LIMIT 80", (session["id"],))]
            return dict(mode="sintético", stage="local", crew=CREW, session=session, records=records,
                        devices=self.devices(db, session), device_info=DEVICES, history=history, guide=GUIDE,
                        metrics=METRICS, audit=audit, protocol=None, server_time=now(),
                        classifications={"dados": "simulados", "fila": "implementada", "receptor": "simulado",
                                         "hardware de voo": "conceitual"})

    def remote_write(self, db, rows, conflicting=False):
        with connect(self.remote, write=True) as remote:
            for row in rows:
                existing = remote.execute("SELECT hash FROM received WHERE id=?", (row["id"],)).fetchone()
                if existing is None:
                    body = row["data"] if not conflicting else encode({**json.loads(row["data"]), "fixture": "different"})
                    checksum = row["hash"] if not conflicting else digest(json.loads(body))
                    remote.execute("INSERT INTO received VALUES(?,?,?,?,?)",
                                   (row["id"], row["receiver"], checksum, body, now()))
                db.execute("UPDATE outbox SET state='sent' WHERE id=?", (row["id"],))

    def delivery(self, db, session, mode):
        if not session["link"]:
            return "Enlace interrompido. Registros continuam na fila.", 200
        rows = db.execute("""
            SELECT e.*, o.receiver, o.state FROM events e JOIN outbox o USING(id)
            WHERE e.session_id=? AND o.state NOT IN ('confirmed','conflict') ORDER BY e.rowid
        """, (session["id"],)).fetchall()
        if mode == "ack":
            with connect(self.remote) as remote:
                count = 0
                for row in rows:
                    if row["state"] != "sent":
                        continue
                    evidence = remote.execute("SELECT hash,receiver FROM received WHERE id=?", (row["id"],)).fetchone()
                    if evidence is None:
                        db.execute("UPDATE outbox SET state='error',last_error=? WHERE id=?",
                                   ("Recibo inexistente no receptor.", row["id"]))
                    elif evidence["hash"] != row["hash"] or evidence["receiver"] != row["receiver"]:
                        db.execute("UPDATE outbox SET state='conflict',last_error=? WHERE id=?",
                                   ("Conteúdo ou destino divergente para este ID.", row["id"]))
                        self.audit(db, session, "Conflito no receptor", row["id"])
                    else:
                        db.execute("UPDATE outbox SET state='confirmed',ack_at=?,last_error=NULL WHERE id=?",
                                   (now(), row["id"]))
                        count += 1
            self.audit(db, session, "Confirmação do receptor", detail=f"{count} registros confirmados.")
            return f"{count} registros confirmados pelo receptor fictício.", 200
        if mode not in ("prepare", "send", "interrupt", "lose_ack", "remote_conflict"):
            raise ValueError("Modo de entrega inválido.")
        if mode == "remote_conflict":
            rows = rows[:1]
        if not rows:
            return "Sem registros pendentes para enviar.", 200
        db.executemany("UPDATE outbox SET state='sending',last_error=NULL WHERE id=?",
                       [(r["id"],) for r in rows])
        if mode == "prepare":
            self.audit(db, session, "Envio preparado", detail=f"{len(rows)} itens aguardam transmissão.")
            return f"{len(rows)} itens na etapa de envio.", 200
        db.executemany("UPDATE outbox SET attempts=attempts+1 WHERE id=?", [(r["id"],) for r in rows])
        if mode == "interrupt":
            self.set_field(db, session, "link", 0)
            db.executemany("UPDATE outbox SET state='error',last_error=? WHERE id=?",
                           [("Enlace caiu durante o envio.", r["id"]) for r in rows])
            self.audit(db, session, "Interrupção de envio", detail=f"{len(rows)} registros podem ser reenviados.")
            return "Enlace interrompido durante o envio. Registros permanecem na fila.", 200
        try:
            self.remote_write(db, rows, conflicting=mode == "remote_conflict")
        except sqlite3.Error:
            db.executemany("UPDATE outbox SET state='error',last_error=? WHERE id=?",
                           [("Falha de escrita no receptor.", r["id"]) for r in rows])
            return "Falha no receptor. Registros mantidos para nova tentativa.", 503
        if mode == "lose_ack":
            db.executemany("UPDATE outbox SET last_error=? WHERE id=?",
                           [("Confirmação perdida no cenário.", r["id"]) for r in rows])
        self.audit(db, session, "Enviado ao receptor fictício", detail=f"{len(rows)} itens aguardam confirmação.")
        return f"{len(rows)} itens enviados. Aguardando confirmação.", 200

    def advanced(self, db, session, data):
        step = session["step"]
        if step is None or step >= len(GUIDE) - 1:
            return "Cenário concluído ou indisponível.", 200
        if data.get("expected_step") != step:
            return "Atualize a etapa antes de avançar.", 409
        next_step = step + 1
        if session["storage_fault"]:
            return "Desative a falha de armazenamento antes de avançar.", 503
        if session["phase"] == "encerrada":
            return "Esta sessão foi encerrada. Inicie uma nova demonstração.", 409
        base = datetime.fromisoformat(session["started"])
        if next_step == 1:
            self.set_field(db, session, "phase", "exercício")
            for i in range(3, 10):
                self.sample(db, session, i, "exercício", captured=(base + timedelta(seconds=i * 2)).isoformat())
        elif next_step == 2:
            db.execute("UPDATE devices SET connection='offline' WHERE session_id=? AND type='shirt' AND connection!='revoked'",
                       (session["id"],))
            for i in (10, 11):
                self.sample(db, session, i, "exercício", captured=(base + timedelta(seconds=i * 2)).isoformat())
        elif next_step == 3:
            self.note(db, session, "checkin", "Gostaria de revisar a perda de sinal durante o exercício.",
                      "Quero revisar a sessão", True)
        elif next_step == 4:
            self.set_field(db, session, "link", 0)
            self.note(db, session, "review", "Revisão do sensor torácico durante o exercício.", "Revisão técnica", True)
        elif next_step == 5:
            self.set_field(db, session, "link", 1)
            result = self.delivery(db, {**session, "link": 1}, "lose_ack")
            if result[1] != 200:
                return result
        elif next_step == 6:
            for mode in ("send", "ack"):
                result = self.delivery(db, session, mode)
                if result[1] != 200:
                    return result
            if not session["link"]:
                return "Religue o enlace antes de confirmar.", 409
        elif next_step == 7:
            db.execute("UPDATE devices SET connection='online' WHERE session_id=? AND type='shirt' AND connection!='revoked'",
                       (session["id"],))
            self.set_field(db, session, "phase", "recuperação")
            for i in range(13, 18):
                self.sample(db, session, i, "recuperação")
        self.set_field(db, session, "step", next_step)
        self.audit(db, session, "Etapa guiada", detail=GUIDE[next_step][0])
        return GUIDE[next_step][0], 200

    def device_action(self, db, session, data):
        mode = data.get("mode")
        if session["phase"] == "encerrada":
            return "Selecione uma sessão ativa.", 409
        device = next((d for d in self.devices(db, session) if d["id"] == data.get("device") and d["connection"] != "revoked"), None)
        if device is None:
            raise ValueError("Dispositivo indisponível nesta sessão.")
        metric = next(k for k, info in METRICS.items() if info[4] == device["type"])
        value = fixture_values(14, session["astronaut_id"])[metric]
        if mode == "replace":
            new_id = device["id"].split("-RPL-")[0] + "-RPL-" + uuid4().hex[:6].upper()
            db.execute("UPDATE devices SET connection='revoked' WHERE id=?", (device["id"],))
            db.execute("INSERT INTO devices (id,session_id,type,battery) VALUES(?,?,?,?)",
                       (new_id, session["id"], device["type"], DEVICES[device["type"]]["battery"]))
            self.audit(db, session, "Dispositivo substituído", detail=device["id"] + " → " + new_id)
            return "Novo dispositivo associado. Histórico preservado.", 200
        if mode not in ("offline", "online", "battery", "stale"):
            raise ValueError("Comando de dispositivo inválido.")
        if session["storage_fault"]:
            return "Falha simulada de armazenamento. Alteração não salva.", 503
        if mode in ("offline", "online"):
            db.execute("UPDATE devices SET connection=? WHERE id=?", (mode, device["id"]))
        if mode == "battery":
            db.execute("UPDATE devices SET battery=12,connection='online' WHERE id=?", (device["id"],))
        missing = mode == "offline" or (mode == "stale" and device["connection"] == "offline")
        quality = ("disconnected" if missing else "stale" if mode == "stale" else
                   "low_battery" if mode == "battery" or device["battery"] < 20 else "usable")
        for code, details in METRICS.items():
            if details[4] != device["type"]:
                continue
            measure = None if missing else fixture_values(14, session["astronaut_id"])[code]
            raw = packet(session, device, code, measure, stamp(-900 if mode == "stale" else 0), quality=quality)
            self.ingest(db, session, raw)
        self.audit(db, session, "Cenário de dispositivo", detail=f"{DEVICES[device['type']]['label']} · {QUALITIES[quality]}")
        return QUALITIES[quality], 200

    def failure(self, db, session, mode):
        device = next(d for d in self.devices(db, session) if d["type"] == "shirt" and d["connection"] != "revoked")
        raw = packet(session, device, "thermal", 37.1, now())
        if mode == "order":
            raw["captured_at"] = stamp(-900)
            raw["quality"] = "out_of_order"
            return self.ingest(db, session, raw)
        if mode in ("duplicate", "conflict"):
            row = db.execute("SELECT data FROM events WHERE session_id=? AND kind='reading' ORDER BY rowid LIMIT 1",
                             (session["id"],)).fetchone()
            if not row:
                return "Gere uma leitura antes de simular o reenvio.", 409
            raw = json.loads(row[0])
            if mode == "conflict":
                raw["value"] = (raw["value"] or 37) + 0.1
                if raw["quality"] == "disconnected":
                    raw["quality"] = "usable"
        elif mode == "unit":
            raw["unit"] = "°F"
        elif mode == "clock":
            raw["captured_at"] = "sem fuso"
        elif mode == "profile":
            raw["device_id"] = db.execute("""
                SELECT d.id FROM devices d JOIN sessions s ON d.session_id=s.id
                WHERE s.astronaut_id!=? AND s.selected=1 AND d.type='shirt' LIMIT 1
            """, (session["astronaut_id"],)).fetchone()[0]
        elif mode == "unknown":
            raw["device_id"] = "SEM-CADASTRO"
        else:
            raise ValueError("Cenário de falha inválido.")
        return self.ingest(db, session, raw)

    def action(self, crew, data):
        with connect(self.local, write=True) as db:
            op = data.get("op")
            session = self.session(db, crew, data.get("session_id"))
            result = ("Operação registrada.", 200)
            if op in ("new", "guide_start"):
                activity = data.get("activity", "Esteira orbital")
                if activity not in ("Esteira orbital", "Cicloergômetro", "Treino resistido"):
                    raise ValueError("Atividade inválida.")
                session = self.create(db, crew, activity, guided=op == "guide_start")
                self.sample(db, session, 0, "preparação", offset=-6)
                self.sample(db, session, 1, "preparação", offset=-4)
                self.sample(db, session, 2, "preparação", offset=-2)
                self.audit(db, session, "Sessão iniciada", detail=activity)
                result = ("Nova sessão iniciada.", 200)
            elif op == "phase":
                phase = data.get("phase")
                if phase not in PHASES or session["phase"] == PHASES[-1]:
                    raise ValueError("Selecione uma fase de uma sessão ativa.")
                self.set_field(db, session, "phase", phase)
                if phase == PHASES[-1]:
                    self.set_field(db, session, "ended", now())
                self.audit(db, session, "Fase alterada", detail=phase)
            elif op == "sample":
                if session["phase"] == PHASES[-1]:
                    raise ValueError("Sessão encerrada.")
                readings = db.execute("""
                    SELECT data
                    FROM events WHERE session_id=? AND kind='reading'
                """, (session["id"],))
                i = max((json.loads(row["data"])["sequence"] for row in readings), default=-1) + 1
                result = self.sample(db, session, i, session["phase"])
                if result[1] == 200:
                    self.audit(db, session, "Amostras geradas", detail=result[0])
            elif op == "link":
                self.set_field(db, session, "link", int(not session["link"]))
                result = ("Enlace interrompido." if session["link"] else "Enlace disponível.", 200)
                self.audit(db, session, "Enlace simulado", detail=result[0])
            elif op == "storage":
                self.set_field(db, session, "storage_fault", int(not session["storage_fault"]))
                result = ("Armazenamento restaurado." if session["storage_fault"] else "Falha de armazenamento ativada.", 200)
                self.audit(db, session, "Falha de armazenamento", detail=result[0])
            elif op in ("checkin", "review"):
                result = self.note(db, session, op, data.get("text", ""), data.get("label"), data.get("authorized", False))
            elif op == "sync":
                result = self.delivery(db, session, data.get("mode"))
            elif op == "device":
                result = self.device_action(db, session, data)
            elif op == "fail":
                result = self.failure(db, session, data.get("mode"))
            elif op == "ingest":
                raw = data.get("reading")
                if not isinstance(raw, dict):
                    raise ValueError("Informe uma leitura.")
                result = self.ingest(db, session, raw)
            elif op == "guide_next":
                result = self.advanced(db, session, data)
            else:
                raise ValueError("Operação desconhecida.")
        return dict(message=result[0], saved=result[1] == 200, session_id=session["id"]), result[1]

