import json
import sys
from pathlib import Path
from main import app
Path(sys.argv[1]).write_text(json.dumps(app.openapi(), indent=2) + '\n', encoding='utf-8')
