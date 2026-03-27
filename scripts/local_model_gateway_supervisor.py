import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
import fcntl
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(
    os.getenv(
        "LOCAL_AGENT_DATA_DIR",
        str(Path.home() / "Library" / "Application Support" / "local-agent-lab" / "observability"),
    )
)
SUPERVISOR_PID_FILE = DATA_DIR / "local-gateway-supervisor.pid"
CHILD_PID_FILE = DATA_DIR / "local-gateway.pid"
LOG_FILE = DATA_DIR / "local-gateway.log"
STATE_FILE = DATA_DIR / "local-gateway-supervisor-state.json"
LOCK_FILE = DATA_DIR / "local-gateway-supervisor.lock"
GATEWAY_SCRIPT = PROJECT_ROOT / "scripts" / "local_model_gateway.py"

RESTART_DELAY_SECONDS = 1.5
stopping = False
child_process: subprocess.Popen[str] | None = None
lock_handle = None


def read_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {
            "restart_count": 0,
            "last_start_at": None,
            "last_exit_at": None,
            "last_exit_code": None,
            "last_event": None,
            "supervisor_pid": None,
            "child_pid": None,
        }


def write_state(patch: dict):
    state = read_state()
    state.update(patch)
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, value: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def remove_file(path: Path):
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def acquire_single_instance_lock() -> bool:
    global lock_handle
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    lock_handle = LOCK_FILE.open("a+", encoding="utf-8")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return False
    lock_handle.seek(0)
    lock_handle.truncate()
    lock_handle.write(f"{os.getpid()}\n")
    lock_handle.flush()
    return True


def release_single_instance_lock():
    global lock_handle
    if lock_handle is None:
        return
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
    except Exception:
        pass
    try:
        lock_handle.close()
    except Exception:
        pass
    lock_handle = None
    remove_file(LOCK_FILE)


def gateway_healthy() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:4000/health", timeout=1.2) as response:
            return response.status == 200
    except Exception:
        return False


def handle_signal(signum, frame):  # noqa: ANN001
    global stopping
    stopping = True
    write_state(
        {
            "last_event": f"signal:{signum}",
            "supervisor_pid": os.getpid(),
            "child_pid": child_process.pid if child_process and child_process.poll() is None else None,
        }
    )
    if child_process and child_process.poll() is None:
        try:
            child_process.terminate()
        except ProcessLookupError:
            pass


def main():
    global child_process
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    if not acquire_single_instance_lock():
        write_state(
            {
                "last_event": "duplicate_supervisor_exit",
                "supervisor_pid": os.getpid(),
                "child_pid": None,
            }
        )
        return

    write_text(SUPERVISOR_PID_FILE, str(os.getpid()))
    write_state(
        {
            "supervisor_pid": os.getpid(),
            "child_pid": None,
            "last_event": "supervisor_started",
        }
    )

    python_executable = sys.executable

    try:
        while not stopping:
            if gateway_healthy():
                write_state(
                    {
                        "supervisor_pid": os.getpid(),
                        "child_pid": None,
                        "last_event": "gateway_already_running",
                    }
                )
                time.sleep(RESTART_DELAY_SECONDS)
                continue
            state = read_state()
            with LOG_FILE.open("a", encoding="utf-8") as log_handle:
                log_handle.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] starting local_model_gateway.py\n")
                log_handle.flush()
                child_process = subprocess.Popen(
                    [python_executable, "-u", str(GATEWAY_SCRIPT)],
                    cwd=str(PROJECT_ROOT),
                    stdout=log_handle,
                    stderr=log_handle,
                    text=True,
                )
                write_text(CHILD_PID_FILE, str(child_process.pid))
                write_state(
                    {
                        "supervisor_pid": os.getpid(),
                        "child_pid": child_process.pid,
                        "restart_count": int(state.get("restart_count") or 0) + 1,
                        "last_start_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                        "last_event": "gateway_started",
                    }
                )
                exit_code = child_process.wait()
                remove_file(CHILD_PID_FILE)
                write_state(
                    {
                        "supervisor_pid": os.getpid(),
                        "child_pid": None,
                        "last_exit_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                        "last_exit_code": exit_code,
                        "last_event": "gateway_exited",
                    }
                )
                log_handle.write(
                    f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] local_model_gateway.py exited with code {exit_code}\n"
                )
                log_handle.flush()

            if stopping:
                break

            time.sleep(RESTART_DELAY_SECONDS)
    finally:
        write_state(
            {
                "child_pid": None,
                "supervisor_pid": None,
                "last_event": "supervisor_stopped",
            }
        )
        remove_file(CHILD_PID_FILE)
        remove_file(SUPERVISOR_PID_FILE)
        release_single_instance_lock()


if __name__ == "__main__":
    main()
