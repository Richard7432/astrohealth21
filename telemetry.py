"""Synthetic device and scenario fixtures. Ranges are instrumental demo rules."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

CREW = {
    "A12": {"name": "Luna Vega", "role": "Especialista de missão"},
    "B07": {"name": "Orion Costa", "role": "Engenheiro de voo"},
}
DEVICES = {
    "shirt": {"label": "Sensor torácico", "code": "THX", "battery": 92,
              "description": "Temperatura da pele, tendência térmica estimada e frequência por ECG simulado. Respiração e contato são capacidades propostas."},
    "watch": {"label": "Smartwatch", "code": "WCH", "battery": 86,
              "description": "Pulso por PPG e SpO₂ sintéticos. Orientação, gasto energético e bioimpedância dependem de método e validação."},
    "left": {"label": "Palmilha esquerda", "code": "PL-E", "battery": 78,
             "description": "Carga plantar sintética. A combinação de uma IMU e sensores de contato é uma proposta de instrumentação."},
    "right": {"label": "Palmilha direita", "code": "PL-D", "battery": 81,
              "description": "Carga plantar sintética. O giroscópio sozinho não fornece posição absoluta confiável."},
    "treadmill": {"label": "Esteira orbital", "code": "TRD", "battery": 100,
                  "description": "Distância da esteira fictícia. A telemetria da máquina e a estimativa das palmilhas têm origens distintas."},
    "capsule": {"label": "Cápsula GI", "code": "CGI", "battery": 74,
                "description": "Temperatura gastrointestinal sintética para ilustrar um conceito de pesquisa. pH, pressão e gases estão indisponíveis neste demo."},
}
METRICS = {
    "thermal": ("Térmica estimada", "°C", 0, 60, "shirt", True),
    "skin": ("Temperatura da pele", "°C", 0, 60, "shirt", False),
    "ecg": ("Frequência por ECG", "bpm", 0, 260, "shirt", False),
    "pulse": ("Pulso por PPG", "bpm", 0, 260, "watch", True),
    "spo2": ("SpO₂ estimada", "%", 0, 100, "watch", True),
    "left_force": ("Carga esquerda", "N", 0, 6000, "left", False),
    "right_force": ("Carga direita", "N", 0, 6000, "right", False),
    "left_steps": ("Passos · lado esquerdo", "passos", 0, 100000, "left", True),
    "right_steps": ("Passos · lado direito", "passos", 0, 100000, "right", True),
    "belt": ("Distância da esteira", "m", 0, 50000, "treadmill", False),
    "gi": ("Temperatura gastrointestinal", "°C", 0, 60, "capsule", False),
}
PHASES = ("preparação", "exercício", "recuperação", "encerrada")
GUIDE = (
    ("Preparação", "Inicie uma sessão fictícia com os dispositivos cadastrados para o perfil selecionado."),
    ("Exercício", "Compare as leituras sintéticas e observe a origem dos sinais."),
    ("Perda de sinal", "O sensor torácico desconecta. A ausência aparece como lacuna na curva térmica."),
    ("Check-in e apoio", "Um check-in fictício é registrado e o apoio local fica disponível."),
    ("Interrupção do enlace", "Uma revisão autorizada entra na fila. A entrega fica pendente com o enlace interrompido."),
    ("Retorno do enlace", "O receptor fictício recebe a primeira transmissão. A confirmação ainda está pendente."),
    ("Confirmação", "O receptor confirma a gravação. Uma retransmissão com o mesmo conteúdo é deduplicada."),
    ("Recuperação", "O sensor volta a transmitir. Revise a recuperação, a lacuna e as confirmações na fila."),
)


def stamp(offset=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=offset)).isoformat(timespec="seconds")


def packet(session, device, metric, value, captured_at, *, quality="usable", phase=None, sequence=0):
    return dict(
        event_id=uuid4().hex, astronaut_id=session["astronaut_id"], session_id=session["id"],
        device_id=device["id"], device_type=device["type"], metric_code=metric, value=value,
        unit=METRICS[metric][1], origin="synthetic", estimated=METRICS[metric][5],
        captured_at=captured_at, phase=phase or session["phase"], quality=quality,
        calibration="não aplicável · simulação", schema_version=1, sequence=sequence,
    )


def fixture_values(i, crew):
    offset = 0.21 if crew == "B07" else 0
    heat = (0.07, 0.1, 0.14, 0.22, 0.31, 0.48, 0.61, 0.76, 0.88, 0.94,
            0.92, 0.85, 0.78, 0.64, 0.54, 0.47, 0.39, 0.34)[i % 18]
    return {
        "thermal": round(36.78 + heat + offset, 2), "skin": round(33.1 + heat * 0.8 + offset, 2),
        "ecg": 72 + int(heat * 132) % 83 + int(offset * 28),
        "pulse": 74 + int(heat * 132) % 83 + int(offset * 28), "spo2": 98 - i % 2,
        "left_force": 130 + i * 3, "right_force": 148 + i * 2, "belt": 64 * i,
        "left_steps": i * 46, "right_steps": i * 45, "gi": round(37.03 + heat * 0.54 + offset, 2),
    }

