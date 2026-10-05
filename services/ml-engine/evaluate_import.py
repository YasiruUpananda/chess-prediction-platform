"""Evaluate an approved PGN after a reviewed import; never promotes weights."""
import argparse
import json
from pathlib import Path
from evaluate_predictions import evaluate
from worker import resolve_pgn_path

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('filename');parser.add_argument('--output',required=True);args=parser.parse_args()
    path=resolve_pgn_path(args.filename)
    result=evaluate(path)
    destination=Path(args.output);destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print('Chronological evidence coverage:',result['evidence_coverage'])
