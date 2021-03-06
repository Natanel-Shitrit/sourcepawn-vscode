import {
  FileCompletions,
  FunctionCompletion,
  DefineCompletion,
  FunctionParam,
  MethodCompletion,
  VariableCompletion,
	EnumCompletion,
	EnumMemberCompletion
} from "./completions";
import * as fs from "fs";

export function parse_file(file: string, completions: FileCompletions, IsBuiltIn:boolean=false) {
  fs.readFile(file, "utf-8", (err, data) => {
    parse_blob(data, completions, file, IsBuiltIn);
  });
}

export function parse_blob(
  data: string,
  completions: FileCompletions,
  file = "",
  IsBuiltIn:boolean=false
) {
  if (typeof data === "undefined") {
    return; // Asked to parse empty file
  }
  let lines = data.split("\n");
  let parser = new Parser(lines, completions);
  parser.parse(file, IsBuiltIn);
}

enum State {
  None,
  MultilineComment,
  DocComment,
  Enum,
  Methodmap,
  Property,
}

class Parser {
  lines: string[];
  completions: FileCompletions;
  state: State[];
  scratch: any;
  state_data: any;

  constructor(lines: string[], completions: FileCompletions) {
    this.lines = lines;
    this.completions = completions;
    this.state = [State.None];
  }

  parse(file, IsBuiltIn:boolean = false) {
    let line = this.lines.shift();
    if (typeof line === "undefined") {
      return;
    }

    let match = line.match(/\s*#define\s+([A-Za-z0-9_]+)/);
    if (match) {
      this.completions.add(match[1], new DefineCompletion(match[1]));
      return this.parse(file, IsBuiltIn);
    }

    match = line.match(/^\s*#include\s+<([A-Za-z0-9\-_\/]+)>\s*$/);
    if (match) {
      this.completions.resolve_import(match[1], false, IsBuiltIn);
      return this.parse(file, IsBuiltIn);
    }

    match = line.match(/^\s*#include\s+"([A-Za-z0-9\-_\/]+)"\s*$/);
    if (match) {
      this.completions.resolve_import(match[1], true, IsBuiltIn);
      return this.parse(file, IsBuiltIn);
    }

		// Match enums
		match = line.match(/^\s*(?:enum\s+)([A-z0-9_]*)/);
		if (match) {
			// Create a completion for the enum itself
			let enumCompletion : EnumCompletion = new EnumCompletion(match[1], file);
			this.completions.add(
				match[1],
				enumCompletion
				)
			
			// Set max number of iterations for safety
			let iter = 0;

			// Proceed to the next line
			line = this.lines.shift();

			// Stop early if it's the end of the file
			if(!line)
			{
				return this.parse(file, IsBuiltIn);
			}

			// Match all the params of the enum
			while(iter<20 && !line.match(/^\s*(\}\s*\;)/))
			{
				iter++;
				match = line.match(/^\s*([A-z0-9_]*)\s*.*/);
				line = this.lines.shift();
				
				// Skip if didn't match
				if(!match)
				{
					continue;
				}
				this.completions.add(
					match[1],
					new EnumMemberCompletion(match[1], file, enumCompletion)
					)
				if(!line)
				{
					break;
				}
			}
			return this.parse(file, IsBuiltIn);
		}
		

		// Match for loop iteration variable only in the current file
		match = line.match(/^\s*(?:for\s*\(\s*int\s+)([A-z0-9_]*)/);
		if (match && !IsBuiltIn) {
			this.completions.add(
				match[1],
				new VariableCompletion(match[1], file)
				)
			return this.parse(file, IsBuiltIn);
		}

    // Match variables only in the current file
    match = line.match(
      /^(?:\s*)?(?:bool|char|const|float|int|any|Plugin|Handle|ConVar|Cookie|Database|DBDriver|DBResultSet|DBStatement|GameData|Transaction|Event|File|DirectoryListing|KeyValues|Menu|Panel|Protobuf|Regex|SMCParser|TopMenu|Timer|FrameIterator|GlobalForward|PrivateForward|Profiler)\s+(.*)/
    );
    if (match && !IsBuiltIn) {
      let match_variables = [];
      // Check if it's a multiline declaration
      if (match[1].match(/(;)(?:\s*|)$/)) {
        // Separate potential multiple declarations
        match_variables = match[1].match(
          /(?:\s*)?([A-z0-9_\[`\]]+(?:\s+)?(?:\=(?:(?:\s+)?(?:[\(].*?[\)]|[\{].*?[\}]|[\"].*?[\"]|[\'].*?[\'])?(?:[A-z0-9_\[`\]]*)))?(?:\s+)?|(!,))/g
        );
        for (let variable of match_variables) {
          let variable_completion = variable.match(
            /(?:\s*)?([A-Za-z_,0-9]*)(?:(?:\s*)?(?:=(?:.*)))?/
          )[1];
          this.completions.add(
            variable_completion,
            new VariableCompletion(variable_completion, file)
          );
        }
      } else {
        while (!match[1].match(/(;)(?:\s*|)$/)) {
          // Separate potential multiple declarations
          match_variables = match[1].match(
            /(?:\s*)?([A-z0-9_\[`\]]+(?:\s+)?(?:\=(?:(?:\s+)?(?:[\(].*?[\)]|[\{].*?[\}]|[\"].*?[\"]|[\'].*?[\'])?(?:[A-z0-9_\[`\]]*)))?(?:\s+)?|(!,))/g
          );
          if (!match_variables) {
            break;
          }
          for (let variable of match_variables) {
            let variable_completion = variable.match(
              /(?:\s*)?([A-Za-z_,0-9]*)(?:(?:\s*)?(?:=(?:.*)))?/
            )[1];
            this.completions.add(
              variable_completion,
              new VariableCompletion(variable_completion, file)
            );
          }
          match[1] = this.lines.shift();
        }
      }

      return this.parse(file, IsBuiltIn);
    }

    match = line.match(/\s*\/\*/);
    if (match) {
      this.state.push(State.MultilineComment);
      this.scratch = [];

      this.consume_multiline_comment(line, false, file, IsBuiltIn);
      return this.parse(file, IsBuiltIn);
    }

    match = line.match(/^\s*\/\//);
    if (match) {
      if (this.lines[0] && this.lines[0].match(/^\s*\/\//)) {
        this.state.push(State.MultilineComment);
        this.scratch = [];

        this.consume_multiline_comment(line, true, file, IsBuiltIn);
        return this.parse(file, IsBuiltIn);
      }
    }

    // Match comments to find short function descriptions
    match = line.match(/^\s*\/\/\s*(.*)/);
    if(match) {
      let description : string = match[1];
      line = this.lines.shift()
      match = line.match(/(?:(?:static|native|stock|public|\n)+\s*)+\s+(?:[a-zA-Z\-_0-9]:)?([^\s]+)\s*([A-Za-z_]*)\(([^\)]*)(?:\)?)(?:\s*)(?:\{?)(?:\s*)(?:[^\;\s]*)$/);
      if (match) {
        return this.read_non_descripted_function(match, file, description, IsBuiltIn);
      }
      else {
        this.parse(file, IsBuiltIn);
      }
    }

    match = line.match(
      /^\s*methodmap\s+([a-zA-Z][a-zA-Z0-9_]*)(?:\s+<\s+([a-zA-Z][a-zA-Z0-9_]*))?/
    );
    if (match) {
      this.state.push(State.Methodmap);
      this.state_data = {
        name: match[1],
      };

      return this.parse(file, IsBuiltIn);
    }

    // Match properties
    match = line.match(
      /^\s*property\s+([a-zA-Z][a-zA-Z0-9_]*)\s+([a-zA-Z][a-zA-Z0-9_]*)/
    );
    if (match) {
      if (this.state[this.state.length - 1] === State.Methodmap) {
        this.state.push(State.Property);
      }

      return this.parse(file, IsBuiltIn);
    }

    match = line.match(/}/);     
    if (match) {
      this.state.pop();

      return this.parse(file, IsBuiltIn);
    }

    // Match functions without description
    match = line.match(/(?:(?:static|native|stock|public|\n)+\s*)+\s+(?:[a-zA-Z\-_0-9]:)?([^\s]+)\s*([A-Za-z_]*)\(([^\)]*)(?:\)?)(?:\s*)(?:\{?)(?:\s*)(?:[^\;\s]*)$/);
    if (match && !IsBuiltIn) {
      this.read_non_descripted_function(match, file, "", IsBuiltIn);
    }

    this.parse(file, IsBuiltIn);
  }

  read_non_descripted_function(match, file: string, description: string = "", IsBuiltIn:boolean=false) {
    let match_buffer = "";
    let line = "";
    let name_match = "";
    let partial_params_match = "";
    let params_match = [];
    // Separation for old and new style functions
    // New style
    if (match[2] != "") {
      name_match = match[2];
    }
    // Old style
    else {
      name_match = match[1];
    }
    partial_params_match = match[3];
    match_buffer = match[0];
    // Check if function takes arguments
    let maxiter = 0;
    while (!match_buffer.match(/(\))(?:\s*)(?:;)?(?:\s*)(?:\{?)(?:\s*)$/) && maxiter<20) {
      line = this.lines.shift();
      partial_params_match+=line;
      match_buffer+=line;
      maxiter++;
    }
    params_match = partial_params_match.match(/([^,\)]+\(.+?\))|([^,\)]+)/g);
    let params = [];
    let current_param;
    if(params_match){
      for (let param of params_match) {
        current_param = {
          label: param,
          documentation: param,
        };
        params.push(current_param);
        // Add the params as variables
        let paramAsVariable = param.match(/([^\s:]*)$/)[1];
        this.completions.add(
          paramAsVariable,
          new VariableCompletion(paramAsVariable, file)
        );
      }
    }
    partial_params_match = this.clean_param(partial_params_match);
    this.completions.add(
      name_match,
      new FunctionCompletion(name_match, partial_params_match, description, params)
    );
    return this.parse(file, IsBuiltIn);
  };

  consume_multiline_comment(
    current_line: string,
    use_line_comment: boolean = false,
    file: string,
    IsBuiltIn: boolean = false
  ) {
    if (typeof current_line === "undefined") {
      return; // EOF
    }

    let match: any = use_line_comment
      ? !/^\s*\/\//.test(current_line)
      : /\*\//.test(current_line);
    if (match) {
      if (this.state[this.state.length - 1] === State.DocComment) {
        this.state.pop();
        this.state.pop();

        if (use_line_comment) {
          return this.read_function(current_line, file, IsBuiltIn);
        } else {
          return this.read_function(this.lines.shift(), file, IsBuiltIn);
        }
      }

      this.state.pop();
      return this.parse(file, IsBuiltIn);
    } else {
      if (!use_line_comment) {
        match = current_line.match(
          /^\s*\*\s*@(?:param|return)\s*([A-Za-z_\.][A-Za-z0-9_\.]*)\s*(.*)/
        );
      } else {
        match = current_line.match(
          /^\s*\/\/\s*@(?:param|return)\s*([A-Za-z_\.][A-Za-z0-9_\.]*)\s*(.*)/
        );
      }

      if (match) {
        if (this.state[this.state.length - 1] !== State.DocComment) {
          this.state.push(State.DocComment);
        }
      }

      this.scratch.push(current_line);

      this.consume_multiline_comment(
        this.lines.shift(),
        use_line_comment,
        file,
        IsBuiltIn
      );
    }
  }

  clean_param(partial_params_match: string){
    let unused_comma = partial_params_match.match(/(\))(?:\s*)(?:;)?(?:\s*)$/);
    if(unused_comma) {
      partial_params_match = partial_params_match.replace(unused_comma[1], "");
    }
    return partial_params_match;
  }

  read_function(line: string, file: string, IsBuiltIn:boolean=false) {
    if (typeof line === "undefined") {
      return;
    }

    if (line.includes(":")) {
      this.read_old_style_function(line);
    } else {
      this.read_new_style_function(line);
    }

    this.state.pop();
    this.parse(file, IsBuiltIn);
  }

  read_old_style_function(line: string) {
    let match = line.match(
      /\s*(?:(?:static|native|stock|public)+\s*)+\s+(?:[a-zA-Z\-_0-9]:)?([^\s]+)\s*\(\s*([A-Za-z_].*)/
    );
    if (match) {
      let { description, params } = this.parse_doc_comment();
      this.completions.add(
        match[1],
        new FunctionCompletion(match[1], match[2], description, params)
      );
    }
  }

  read_new_style_function(line: string) {
    let match = line.match(
      /\s*(?:(?:static|native|stock|public)+\s*)+\s+([^\s]+)\s*([A-Za-z_].*)/
    );
    if (match) {
      let { description, params } = this.parse_doc_comment();
      let name_match = match[2].match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (this.state[this.state.length - 1] === State.Methodmap) {
        this.completions.add(
          name_match[1],
          new MethodCompletion(
            this.state_data.name,
            name_match[1],
            match[2],
            description,
            params
          )
        );
      } else {
        let paramsMatch = match[2];
        // Iteration safety in case something goes wrong
        let maxiter=0;
        while(!paramsMatch.match(/(\))(?:\s*)(?:;)?(?:\s*)(?:\{?)(?:\s*)$/) && maxiter<20) {
          paramsMatch += this.lines.shift();
          maxiter++;
        }
        this.completions.add(
          name_match[1],
          new FunctionCompletion(name_match[1], paramsMatch, description, params)
          );
      }
    }
  }

  parse_doc_comment(): { description: string; params: FunctionParam[] } {
    let description = (() => {
      let lines = [];
      for (let line of this.scratch) {
        if (
          !(/^\s*\*\s+([^@].*)/.test(line) || /^\s*\/\/\s+([^@].*)/.test(line))
        ) {
          break;
        }

        lines.push(line.replace(/^\s*\*\s+/, "").replace(/^\s*\/\/\s+/, ""));
      }

      return lines.join(" ");
    })();

    const paramRegex = /@param\s+([A-Za-z0-9_\.]+)\s+(.*)/;
    let params = (() => {
      let params = [];
      let current_param;
      for (let line of this.scratch) {
        let match = line.match(paramRegex);
        if (match) {
          if (current_param) {
            current_param.documentation = current_param.documentation.join(" ");
            params.push(current_param);
          }

          current_param = { label: match[1], documentation: [match[2]] };
        } else {
          if (!/@(?:return|error)/.test(line)) {
            let match = line.match(/\s*(?:\*|\/\/)\s*(.*)/);
            if (match) {
              if (current_param) {
                current_param.documentation.push(match[1]);
              }
            }
          } else {
            if (current_param) {
              current_param.documentation = current_param.documentation.join(
                " "
              );
              params.push(current_param);

              current_param = undefined;
            }
          }
        }
      }

      return params;
    })();

    return { description, params };
  }
}
