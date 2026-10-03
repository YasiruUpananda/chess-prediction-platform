"""Read an official FIDE XML ZIP without extracting its files."""
import argparse
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET


def build(archive, output, country='SRI'):
    players = []
    with zipfile.ZipFile(archive) as source:
        entries = [item for item in source.infolist() if item.filename.lower().endswith('.xml')]
        if len(entries) != 1 or entries[0].file_size > 1024*1024*1024:
            raise ValueError('Expected a single FIDE XML document below 1 GiB')
        with source.open(entries[0]) as stream:
            for _, element in ET.iterparse(stream, events=['end']):
                if element.tag != 'player': continue
                if element.findtext('country') == country:
                    fide_id = element.findtext('fideid'); name = element.findtext('name')
                    if fide_id and name:
                        players.append({'fide_id':fide_id,'name':name,'country':country,'aliases':[]})
                element.clear()
    target = Path(output); target.parent.mkdir(parents=True,exist_ok=True)
    with target.open('x',encoding='utf8') as destination:
        json.dump({'source':Path(archive).name,'country':country,
                   'players':sorted(players,key=lambda player:player['name'])},destination,indent=2,ensure_ascii=False)
        destination.write('\n')
    return len(players)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('--output',required=True)
    parser.add_argument('--country',default='SRI')
    args = parser.parse_args()
    print(f'Prepared {build(args.archive,args.output,args.country)} federation player identities.')
